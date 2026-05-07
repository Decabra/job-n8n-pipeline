// Build exclusion lists for source APIs from existing Airtable rows.
// Goal: avoid paying credits for IDs we have already seen.
const rows = $('Airtable List Existing (Source Exclusions)').all().map((i) => i.json || {});

const THEIRSTACK_MAX_IDS = 500;
const theirstackIds = [];
const seenTheirstack = new Set();

for (const row of rows) {
  const source = String(row.source || '').trim().toLowerCase();
  const sid = String(row.source_job_id || '').trim();
  if (!sid) continue;

  if (source === 'theirstack' && !seenTheirstack.has(sid)) {
    seenTheirstack.add(sid);
    theirstackIds.push(sid);
    if (theirstackIds.length >= THEIRSTACK_MAX_IDS) break;
  }
}

return [{
  json: {
    theirstack_job_id_not: theirstackIds,
  },
}];
