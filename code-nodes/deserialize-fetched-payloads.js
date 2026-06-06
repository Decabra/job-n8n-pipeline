// Workflow 02 entry: Airtable FETCHED rows → job items for Split Jobs.
//
// - 0 Airtable rows → this node does not run (n8n stops the branch).
// - Rows present but none deserialize → return [] (branch stops, no Azure).
//
// Do not add alwaysOutputData on Airtable List FETCHED — that fakes an
// empty item and would wake Split Jobs with no real job.
const indexRows = $input.all().map((i) => i.json || {});

const out = [];
const stats = {
  index_rows: indexRows.length,
  deserialized: 0,
  dropped_no_payload: 0,
  dropped_bad_json: 0,
  dropped_missing_id: 0,
};

for (const row of indexRows) {
  const raw = row.payload_json;
  if (!raw) {
    stats.dropped_no_payload++;
    continue;
  }

  let payload;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    stats.dropped_bad_json++;
    continue;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    stats.dropped_bad_json++;
    continue;
  }

  const sid = String(payload.source_job_id || row.source_job_id || '').trim();
  const src = String(payload.source || row.source || '').trim();
  if (!sid || !src) {
    stats.dropped_missing_id++;
    continue;
  }
  payload.source_job_id = sid;
  payload.source = src;

  out.push({ json: payload });
  stats.deserialized++;
}

if (out.length === 0) return [];

out[0] = {
  ...out[0],
  json: { ...out[0].json, _deserialize_stats: stats },
};

return out;
