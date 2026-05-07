const items = $input.all();
const results = [];

function quickHash12(input) {
  const str = String(input || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').substring(0, 12);
}

for (const item of items) {
  const job = item.json;

  const jdHash = quickHash12(job.job_description || '');
  const applicationId = `APP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // JSearch official field: job_id (unique listing id from Google Jobs index)
  const source_job_id = String(job.job_id || '').trim();

  const locDisplay = job.job_city
    ? `${job.job_city}, ${job.job_state || ''}`.trim()
    : job.job_location || 'Unknown';

  results.push({
    json: {
      application_id: applicationId,
      source_job_id,
      company: job.employer_name || 'Unknown',
      job_title: job.job_title || 'Unknown',
      location: locDisplay,
      job_url: job.job_google_link || '',
      application_url: job.job_apply_link || '',
      source: 'jsearch',
      date_found: new Date().toISOString().split('T')[0],
      date_posted: job.job_posted_at_datetime_utc || job.job_posted_human_readable_when || '',
      remote_status: job.job_is_remote ? 'remote' : 'unknown',
      salary:
        job.job_min_salary && job.job_max_salary
          ? `${job.job_min_salary}-${job.job_max_salary} ${job.job_salary_currency || ''}`.trim()
          : '',
      job_description: job.job_description || '',
      jd_hash: jdHash,
    },
  });
}

return results;
