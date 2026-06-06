const j = $json && typeof $json === 'object' ? $json : {};

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function folderSegmentFromSourceJobId(id, fallback) {
  const t = String(id || '').trim();
  if (!t) return fallback;
  const safe = t
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return safe || fallback;
}

// Blob path: company / (source_job_id from listing OR pipeline application_id).
const companyFolder = slug(j.company) || 'unknown-company';
const innerFolder = folderSegmentFromSourceJobId(j.source_job_id, j.application_id);
const folder_name = `${companyFolder}/${innerFolder}`;

const jdContent =
  `# ${j.company} — ${j.job_title}\n\n` +
  `**Location:** ${j.location}\n` +
  `**URL:** ${j.job_url}\n` +
  `**Apply:** ${j.application_url}\n\n` +
  `---\n\n${j.job_description || ''}`;

const metadata = {
  application_id: j.application_id,
  source_job_id: j.source_job_id || '',
  company: j.company,
  job_title: j.job_title,
  location: j.location,
  job_url: j.job_url,
  application_url: j.application_url,
  source: j.source,
  date_found: j.date_found,
  fit_score: j.fit_score,
  score_breakdown: j.score_raw || {},
  tailoring: {
    fit_summary: j.fit_summary || '',
    key_changes: j.key_resume_changes || [],
    red_flags: j.red_flags || [],
    visa_notes: j.visa_notes || '',
    ats_keywords: j.ats_keywords_added || [],
    cover_letter_md: j.cover_letter_md || '',
  },
  fix_count: 0,
  fix_history: [],
  submission_attempts: [],
  created_at: new Date().toISOString(),
  last_updated: new Date().toISOString(),
};

return {
  json: {
    ...j,
    folder_name,
    jdContent,
    metadata_json: JSON.stringify(metadata, null, 2),
  },
};
