const cfg = $json && typeof $json === 'object' ? $json : {};

/** Bump when `fieldDefs` changes so cache invalidates after template updates. */
const SCHEMA_VERSION = 12;

const pat = String(cfg.airtable_pat || '');
const baseId = String(cfg.airtable_base_id || '');
const tableName = String(cfg.airtable_table_name || 'Jobs Application Tracker');
const rawTtl = cfg.airtable_schema_cache_ttl_seconds;
let cacheTtlMs; 
if (rawTtl === '' || rawTtl === null || rawTtl === undefined) {
  cacheTtlMs = 86400 * 1000;
} else {
  const ttlSeconds = Number(rawTtl);
  if (!Number.isFinite(ttlSeconds)) cacheTtlMs = 86400 * 1000;
  else if (ttlSeconds === 0) cacheTtlMs = 0;
  else cacheTtlMs = ttlSeconds * 1000;
}

if (!pat) throw new Error('[00] Missing airtable_pat in shared config');
if (!baseId) throw new Error('[00] Missing airtable_base_id in shared config');
if (!tableName) throw new Error('[00] Missing airtable_table_name in shared config');

const cacheKey = `${SCHEMA_VERSION}\t${baseId}\t${tableName}`;
let staticData = null;
try {
  staticData = this.getWorkflowStaticData('global');
} catch {
  staticData = null;
}
const entry = staticData && staticData.airtableBootstrapCache;
const useCache =
  staticData &&
  entry &&
  entry.key === cacheKey &&
  typeof entry.at === 'number' &&
  cacheTtlMs > 0 &&
  Date.now() - entry.at < cacheTtlMs;

if (useCache) {
  return {
    json: {
      ...cfg,
      _airtable_bootstrap: {
        cached: true,
        cache_age_ms: Date.now() - entry.at,
        cache_ttl_ms: cacheTtlMs,
        table_name: tableName,
        table_id: entry.tableId || null,
      },
    },
  };
}

const headers = {
  Authorization: `Bearer ${pat}`,
  'Content-Type': 'application/json',
};

/** n8n/axios errors hide Airtable's body in several places — pull all of them. */
function formatHttpErr(err) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (err?.description) parts.push(String(err.description));
  const data = err?.response?.data ?? err?.response?.body ?? err?.body;
  if (data !== undefined && data !== null) {
    parts.push(typeof data === 'string' ? data : JSON.stringify(data));
  }
  if (err?.error && typeof err.error === 'object') {
    try {
      parts.push(JSON.stringify(err.error));
    } catch {
      parts.push(String(err.error));
    }
  }
  return parts.filter(Boolean).join(' | ') || String(err);
}

// Airtable Meta API rejects bare `date` / `dateTime` without options (422).
const dateOpts = { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } };
const dateTimeOpts = {
  dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
  timeFormat: { name: '24hour', format: 'HH:mm' },
  timeZone: 'utc',
};

const fieldDefs = [
  { name: 'application_id', type: 'singleLineText' },
  { name: 'source_job_id', type: 'singleLineText' },
  { name: 'company', type: 'singleLineText' },
  { name: 'job_title', type: 'singleLineText' },
  { name: 'location', type: 'singleLineText' },
  { name: 'job_url', type: 'url' },
  { name: 'application_url', type: 'url' },
  { name: 'source', type: 'singleLineText' },
  { name: 'date_found', type: 'date', options: dateOpts },
  { name: 'date_applied', type: 'date', options: dateOpts },
  // NOTE: ALL_STATUSES is injected from _statuses.js by embed-workflows.mjs.
  { name: 'status', type: 'singleSelect', options: {
    choices: ALL_STATUSES.map((name) => ({ name })),
  } },
  // Meta API requires `options` for number (422 if omitted), same as date fields.
  { name: 'fit_score', type: 'number', options: { precision: 0 } },
  { name: 'resume_link', type: 'url' },
  { name: 'jd_snapshot_link', type: 'url' },
  { name: 'cover_letter_link', type: 'url' },
  { name: 'submission_mode', type: 'singleLineText' },
  { name: 'notes', type: 'multilineText' },
  { name: 'next_action', type: 'singleLineText' },
  { name: 'last_updated', type: 'dateTime', options: dateTimeOpts },
  { name: 'salary', type: 'singleLineText' },
  { name: 'remote_status', type: 'singleLineText' },
  { name: 'visa_notes', type: 'multilineText' },
  { name: 'drive_folder_id', type: 'singleLineText' },
];

const metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;

let meta;
try {
  meta = await this.helpers.httpRequest({
    method: 'GET',
    url: metaUrl,
    headers,
    json: true,
  });
} catch (err) {
  throw new Error(`[00] Airtable metadata GET failed. ${formatHttpErr(err)}`);
}

const tables = Array.isArray(meta?.tables) ? meta.tables : [];
const norm = (s) => String(s || '').trim();
const want = norm(tableName);
let table = tables.find((t) => norm(t?.name) === want);

if (!table) {
  // Create table with primary field only — batching all fields in one POST often returns 422.
  try {
    table = await this.helpers.httpRequest({
      method: 'POST',
      url: metaUrl,
      headers,
      body: {
        name: tableName.trim(),
        fields: [{ name: 'application_id', type: 'singleLineText' }],
      },
      json: true,
    });
  } catch (err) {
    let metaRetry;
    try {
      metaRetry = await this.helpers.httpRequest({
        method: 'GET',
        url: metaUrl,
        headers,
        json: true,
      });
    } catch {
      metaRetry = null;
    }
    table = (Array.isArray(metaRetry?.tables) ? metaRetry.tables : []).find(
      (t) => norm(t?.name) === want,
    );
    if (!table) {
      throw new Error(
        `[00] Airtable create-table failed. HTTP 422 is an invalid request from Airtable — it is not proof your PAT lacks schema.bases:write (GET /meta already proved read access). ` +
          `Re-import workflow 00 so this node is up to date. Full detail: ${formatHttpErr(err)}`,
      );
    }
  }
}

const tableId = table.id;
const existingFields = table.fields || [];
const existingByName = new Map(existingFields.map((f) => [f.name, f]));
// --- Phase 1: Create missing fields ---
const missing = fieldDefs.filter((f) => !existingByName.has(f.name));

for (const field of missing) {
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`,
      headers,
      body: field,
      json: true,
    });
  } catch (err) {
    throw new Error(`[00] Failed creating field "${field.name}" on "${tableName}". ${formatHttpErr(err)}`);
  }
}

const fieldMetaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`;
const tableApiUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
const fieldsUpdated = [];

// --- Phase 2: Type changes (e.g. singleLineText → url, text → singleSelect) ---
// Meta API PATCH works for most valid conversions. Non-fatal: if Airtable rejects
// it we log and move on — the field still works, just with the old type.
for (const def of fieldDefs) {
  const cur = existingByName.get(def.name);
  if (!cur || cur.type === def.type) continue;
  try {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `${fieldMetaUrl}/${cur.id}`,
      headers,
      body: { type: def.type, ...(def.options ? { options: def.options } : {}) },
      json: true,
    });
    fieldsUpdated.push(`${def.name}: ${cur.type} → ${def.type}`);
  } catch (err) {
    fieldsUpdated.push(`${def.name}: type change ${cur.type} → ${def.type} skipped (${formatHttpErr(err)})`);
  }
}

// --- Phase 3: Select choices ---
// Uses Records API with typecast:true (Airtable auto-creates the option),
// then deletes the temp record. The Meta API PATCH for select choices returns
// 422 on many plan/PAT configurations, so this is the only reliable approach.

for (const def of fieldDefs) {
  if (def.type !== 'singleSelect') continue;
  const cur = existingByName.get(def.name);
  if (!cur) continue;

  const desired = Array.isArray(def.options?.choices) ? def.options.choices : [];
  const current = Array.isArray(cur.options?.choices) ? cur.options.choices : [];
  const have = new Set(current.map((c) => String(c?.name || '').trim()).filter(Boolean));
  const need = desired.filter((c) => !have.has(String(c?.name || '').trim()));
  if (!need.length) continue;

  for (const choice of need) {
    const name = String(choice?.name || '').trim();
    if (!name) continue;
    try {
      const created = await this.helpers.httpRequest({
        method: 'POST',
        url: tableApiUrl,
        headers,
        body: {
          records: [{ fields: { application_id: `_SCHEMA_SEED_${Date.now()}`, [def.name]: name } }],
          typecast: true,
        },
        json: true,
      });
      const rid = created?.records?.[0]?.id;
      if (rid) {
        await this.helpers.httpRequest({
          method: 'DELETE',
          url: `${tableApiUrl}/${rid}`,
          headers,
          json: true,
        });
      }
      fieldsUpdated.push(`${def.name}: added choice "${name}"`);
    } catch (err) {
      throw new Error(`[00] Failed adding "${name}" to ${def.name}: ${formatHttpErr(err)}`);
    }
  }
}

if (staticData && cacheTtlMs > 0) {
  staticData.airtableBootstrapCache = {
    key: cacheKey,
    at: Date.now(),
    tableId,
  };
}

return {
  json: {
    ...cfg,
    _airtable_bootstrap: {
      cached: false,
      table_name: tableName,
      table_id: tableId,
      created_table: !tables.find((t) => norm(t?.name) === want),
      fields_added: missing.map((f) => f.name),
      fields_updated: fieldsUpdated,
      cache_ttl_ms: cacheTtlMs,
    },
  },
};
