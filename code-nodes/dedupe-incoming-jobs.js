// In-run dedupe by source_job_id to prevent same-batch duplicates
// from being created before Airtable snapshot can see newly inserted rows.
const items = $input.all();
const seen = new Set();
const out = [];

for (const item of items) {
  const job = item.json || {};
  const sid = String(job.source_job_id || '').trim();

  // Keep items without source_job_id so downstream logic can decide.
  if (!sid) {
    out.push(item);
    continue;
  }

  if (seen.has(sid)) continue;
  seen.add(sid);
  out.push(item);
}

return out;
