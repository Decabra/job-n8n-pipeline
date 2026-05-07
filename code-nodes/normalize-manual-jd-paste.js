const input = $('Manual URL Input').first().json || {};

function fnv1aHex(inputStr) {
  const str = String(inputStr || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const rawJd = String(input.job_description || '').trim();
if (!rawJd || rawJd.length < 50) {
  throw new Error(
    `[Manual Paste] job_description is empty or too short (${rawJd.length} chars). Paste at least 50 characters of JD text.`,
  );
}

const rawUrl = String(input.job_url || '').trim();
const userCompany = String(input.company || '').trim();
const userTitle = String(input.job_title || '').trim();

let jobTitle = userTitle;
let company = userCompany;
let location = '';

const jdLines = rawJd.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);

// First non-empty line is usually the title in copy-pasted JDs
if (!jobTitle && jdLines.length > 0) {
  jobTitle = jdLines[0].slice(0, 200);
}

// Common patterns: "at [Company]", "Company: [X]", or fall back to the second line
if (!company) {
  const colonMatch = rawJd.match(
    /\b(?:Company|Employer|Hiring Organization)\s*:\s*([A-Z][A-Za-z0-9&'.\- ]{2,60})/i,
  );
  const atMatch = rawJd.match(/\bat\s+([A-Z][A-Za-z0-9&'.\- ]{2,60})/);
  if (colonMatch) company = colonMatch[1].trim();
  else if (atMatch) company = atMatch[1].trim();
  else if (jdLines.length > 1) company = jdLines[1].slice(0, 100);
}

const locMatch =
  rawJd.match(/(?:location|office|based in|located in)\s*[:.]?\s*([A-Z][a-zA-Z\s,]+(?:,\s*[A-Z]{2})?)/m) ||
  rawJd.match(/\b(remote|hybrid|on[- ]?site)\b/i);
if (locMatch) location = (locMatch[1] || locMatch[0]).trim();

jobTitle = jobTitle || 'Manual Job';
company = company || 'Unknown';
location = location || 'Unknown';

const remoteHaystack = location + ' ' + rawJd.slice(0, 500);
const remoteStatus = /\bremote\b/i.test(remoteHaystack)
  ? 'remote'
  : /\bhybrid\b/i.test(remoteHaystack)
    ? 'hybrid'
    : 'unknown';

const now = new Date();
// Hash off URL when present, else off content so re-pasting the same JD dedupes
const idSeed = rawUrl || `${jobTitle}|${company}|${rawJd.slice(0, 200)}`;
const sourceJobId = `manual_${fnv1aHex(idSeed)}`;
const applicationId = `APP-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`;

return {
  json: {
    application_id: applicationId,
    source_job_id: sourceJobId,
    company,
    job_title: jobTitle,
    location,
    job_url: rawUrl,
    application_url: rawUrl,
    source: 'manual_paste',
    date_found: now.toISOString().slice(0, 10),
    date_posted: '',
    salary: '',
    remote_status: remoteStatus,
    visa_notes: '',
    job_description: rawJd.slice(0, 14000),
    _jd_scraped: true,
  },
};
