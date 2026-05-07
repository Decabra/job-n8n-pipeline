// Production dedupe: match incoming jobs against existing Airtable rows by source_job_id.
// n8n Airtable v2.1 search returns fields at TOP level (not nested under .fields).
const jobs = $('Dedupe Incoming Jobs').all().map((i) => i.json || {});
const rows = $('Airtable List Existing').all().map((i) => i.json || {});

const bySourceJobId = new Map();
for (const row of rows) {
  // n8n flattens Airtable fields to top level; row.id is the record ID.
  const sid = String(row.source_job_id || '').trim();
  if (sid && !bySourceJobId.has(sid)) {
    bySourceJobId.set(sid, { id: row.id, fields: row });
  }
}

return jobs.map((job) => {
  const sid = String(job.source_job_id || '').trim();
  const dup = sid ? bySourceJobId.get(sid) || null : null;
  return {
    json: {
      ...job,
      _airtable_duplicate: dup,
      is_duplicate: Boolean(dup && dup.id),
    },
  };
});
