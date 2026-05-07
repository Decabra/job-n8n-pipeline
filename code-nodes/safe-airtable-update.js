// Decides whether to update a duplicate Airtable record or skip it.
// Returns the update payload when we should update; returns [] to skip
// (runOnceForAllItems mode: empty array = no output = downstream doesn't fire).
// NOTE: FROZEN_STATUSES is injected from _statuses.js by embed-workflows.mjs.
const items = $input.all();
const results = [];

for (const item of items) {
  const job = item.json || {};
  const row = job._airtable_duplicate;
  if (!row || !row.id) continue;

  const fields = row.fields || {};
  const st = String(fields.status || '').toUpperCase();
  if (FROZEN_STATUSES.includes(st)) continue;

  const existingNotes = fields.notes || '';
  const sid = String(job.source_job_id || '').trim() || '(no source_job_id)';
  const autoNote = `[${new Date().toISOString().split('T')[0]}] Auto: duplicate ingestion (source_job_id=${sid})`;
  const mergedNotes = existingNotes ? `${existingNotes}\n${autoNote}` : autoNote;

  results.push({
    json: {
      record_id: row.id,
      notes: mergedNotes,
    },
  });
}

return results;
