// Write the current fetched batch into the Source Job Index via Airtable's
// REST API with explicit chunking + retry/backoff.
//
// Why this exists:
// - The stock Airtable node started failing repeatedly at `Index All Fetched Jobs`
//   with transport-level "service refused the connection" errors once this
//   branch began handling larger batches and carrying `payload_json`.
// - We only need one very specific write pattern here: upsert the current
//   fetched survivors on `{source_job_id, source}` before the scoring loop
//   starts. Doing it in code gives us control over batch size, retries, and
//   error messages without changing downstream behavior.
//
// Contract:
// - Reads all surviving items from `Filter & Dedupe Incoming`.
// - Upserts them into the Source Job Index in chunks of 10 using Airtable's
//   `performUpsert` REST API.
// - Retries transient transport / rate-limit / 5xx failures with exponential
//   backoff.
// - Returns ONE stats item only (terminal output for Workflow 01).
//   Workflow 02 reads FETCHED rows from the same table independently.
const cfg = $('Config').first().json || {};
const inputItems = $input.all();

const pat = String(cfg.airtable_pat || '').trim();
const baseId = String(cfg.airtable_base_id || '').trim();
const tableName = String(cfg.airtable_source_index_table_name || 'Source Job Index').trim();

if (!pat) throw new Error('[Index All Fetched Jobs] Missing airtable_pat in Config');
if (!baseId) throw new Error('[Index All Fetched Jobs] Missing airtable_base_id in Config');
if (!tableName) throw new Error('[Index All Fetched Jobs] Missing airtable_source_index_table_name in Config');

const headers = {
  Authorization: `Bearer ${pat}`,
  'Content-Type': 'application/json',
};

const tableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
const CHUNK_SIZE = 10;
const MAX_ATTEMPTS = 4;

function formatHttpErr(err) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (err?.description) parts.push(String(err.description));
  if (err?.code) parts.push(`code=${String(err.code)}`);
  const status =
    err?.statusCode ??
    err?.response?.status ??
    err?.response?.statusCode ??
    err?.httpCode ??
    null;
  if (status != null) parts.push(`status=${status}`);
  const data = err?.response?.data ?? err?.response?.body ?? err?.body;
  if (data !== undefined && data !== null) {
    parts.push(typeof data === 'string' ? data : JSON.stringify(data));
  }
  return parts.filter(Boolean).join(' | ') || String(err);
}

function isRetryable(err) {
  const status =
    Number(
      err?.statusCode ??
      err?.response?.status ??
      err?.response?.statusCode ??
      err?.httpCode,
    ) || 0;

  if (status === 429 || status >= 500) return true;

  const msg = formatHttpErr(err).toLowerCase();
  return [
    'refused the connection',
    'offline',
    'econnreset',
    'econnrefused',
    'etimedout',
    'timeout',
    'socket hang up',
    'network',
    'temporarily unavailable',
    'getaddrinfo',
    'dns',
    'fetch failed',
  ].some((needle) => msg.includes(needle));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildPayloadJson(job) {
  const clean = Object.fromEntries(
    Object.entries(job || {}).filter(([key]) => !String(key).startsWith('_')),
  );
  return JSON.stringify(clean);
}

async function patchChunk(records, chunkIndex) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await this.helpers.httpRequest({
        method: 'PATCH',
        url: tableUrl,
        headers,
        body: {
          performUpsert: {
            fieldsToMergeOn: ['source_job_id', 'source'],
          },
          records,
          typecast: false,
        },
        json: true,
      });
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw new Error(
    `[Index All Fetched Jobs] Chunk ${chunkIndex + 1} failed after ${MAX_ATTEMPTS} attempts. ${formatHttpErr(lastErr)}`,
  );
}

const stats = {
  in: inputItems.length,
  chunk_size: CHUNK_SIZE,
  chunks: 0,
  attempted_records: 0,
  created_records: 0,
  updated_records: 0,
};

if (inputItems.length === 0) {
  return [{ json: { _index_stats: { ...stats, skipped: true } } }];
}

const records = inputItems.map((item) => {
  const job = item.json || {};
  return {
    fields: {
      source_job_id: String(job.source_job_id || '').trim(),
      source: String(job.source || '').trim(),
      date_fetched: String(job.date_found || '').trim(),
      outcome: 'FETCHED',
      company: String(job.company || '').trim(),
      job_title: String(job.job_title || '').trim(),
      payload_json: buildPayloadJson(job),
    },
  };
});

const chunks = chunk(records, CHUNK_SIZE);
stats.chunks = chunks.length;

for (let i = 0; i < chunks.length; i++) {
  const res = await patchChunk.call(this, chunks[i], i);
  stats.attempted_records += chunks[i].length;
  stats.created_records += Array.isArray(res?.createdRecords) ? res.createdRecords.length : 0;
  stats.updated_records += Array.isArray(res?.updatedRecords) ? res.updatedRecords.length : 0;
}

return [{ json: { _index_stats: stats } }];
