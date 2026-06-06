// Mark Source Job Index row PROCESSED and store fit_score after Azure scoring.
//
// Uses Airtable REST PATCH + performUpsert (same as Index All Fetched Jobs)
// so we control field types and get clear errors when the column is missing.
const cfg = $('Config').first().json || {};
const j = $json && typeof $json === 'object' ? $json : {};

const pat = String(cfg.airtable_pat || '').trim();
const baseId = String(cfg.airtable_base_id || '').trim();
const tableName = String(cfg.airtable_source_index_table_name || 'Source Job Index').trim();

const sourceJobId = String(j.source_job_id || '').trim();
const source = String(j.source || '').trim();
if (!sourceJobId || !source) {
  throw new Error('[Mark Index Processed] Missing source_job_id or source on input item');
}

if (!pat) throw new Error('[Mark Index Processed] Missing airtable_pat in Config');
if (!baseId) throw new Error('[Mark Index Processed] Missing airtable_base_id in Config');
if (!tableName) throw new Error('[Mark Index Processed] Missing airtable_source_index_table_name in Config');

const headers = {
  Authorization: `Bearer ${pat}`,
  'Content-Type': 'application/json',
};

const tableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
const MAX_ATTEMPTS = 4;

function formatHttpErr(err) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (err?.description) parts.push(String(err.description));
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
    'fetch failed',
  ].some((needle) => msg.includes(needle));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const fitScore = Number(j.fit_score);
const fields = {
  source_job_id: sourceJobId,
  source,
  outcome: 'PROCESSED',
};
if (Number.isFinite(fitScore)) {
  fields.fit_score = Math.round(fitScore);
}

let lastErr;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: tableUrl,
      headers,
      body: {
        performUpsert: {
          fieldsToMergeOn: ['source_job_id', 'source'],
        },
        records: [{ fields }],
        typecast: true,
      },
      json: true,
    });
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;
    await sleep(500 * 2 ** (attempt - 1));
  }
}

if (lastErr) {
  const detail = formatHttpErr(lastErr);
  const hint = /UNKNOWN_FIELD_NAME|fit_score/i.test(detail)
    ? ' Run Workflow 00 (Ensure Airtable Schema) to add fit_score on Source Job Index.'
    : '';
  throw new Error(`[Mark Index Processed] Airtable upsert failed.${hint} ${detail}`);
}

return {
  json: {
    ...j,
    outcome: 'PROCESSED',
    ...(Number.isFinite(fitScore) ? { fit_score: Math.round(fitScore) } : {}),
  },
};
