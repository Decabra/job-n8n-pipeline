const job = $json && typeof $json === 'object' ? $json : {};

function quickHash12(input) {
  const str = String(input || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').substring(0, 12);
}

const source_job_id = job.id != null ? String(job.id) : '';

const company =
  job.company_name || (job.company_object && job.company_object.name) || 'Unknown';
const title = job.job_title || 'Unknown';

const location = job.short_location || job.long_location || job.location || 'Unknown';

const jobUrl = job.url || job.final_url || '';
const applyUrl = job.final_url || job.url || '';

const datePosted = job.date_posted ? String(job.date_posted) : '';

const desc = String(job.description || '');

let remoteStatus = 'unknown';
if (job.remote === true) remoteStatus = 'remote';
else if (job.hybrid === true) remoteStatus = 'hybrid';
else if (job.remote === false && job.hybrid === false) remoteStatus = 'onsite';

let salary = job.salary_string || '';
if (!salary && (job.min_annual_salary || job.max_annual_salary)) {
  const parts = [];
  if (job.min_annual_salary) parts.push(`$${Number(job.min_annual_salary).toLocaleString()}`);
  if (job.max_annual_salary) parts.push(`$${Number(job.max_annual_salary).toLocaleString()}`);
  salary = parts.join(' - ');
}

const jdHash = quickHash12(desc);
const applicationId = `APP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

return {
  json: {
    application_id: applicationId,
    source_job_id,
    company,
    job_title: title,
    location,
    job_url: jobUrl,
    application_url: applyUrl,
    source: 'theirstack',
    date_found: new Date().toISOString().split('T')[0],
    date_posted: datePosted,
    remote_status: remoteStatus,
    salary,
    job_description: desc,
    jd_hash: jdHash,
  },
};
