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

// Job Pulse official output schema: title, company, location, applyUrl, platform, jobId, foundAt, searchQuery
let rawTitle = job.title || 'Unknown';
let company = job.company || 'Unknown';
const location = job.location || 'Unknown';
const applyUrl = String(job.applyUrl || '').trim();

const genericCompanies = ['jobs', 'careers', 'career', 'job', 'apply', 'hiring', 'boards'];
if (genericCompanies.includes(company.toLowerCase().trim())) {
  // Strategy 1: "Title @ Company" pattern (Ashby, Lever)
  const atMatch = rawTitle.match(/[@]\s*(.+)$/i);
  // Strategy 2: "Title - Company" pattern (Breezy, misc) — only if suffix is short (likely a name, not a subtitle)
  const dashMatch = !atMatch && rawTitle.match(/\s[-–—]\s*(.{2,40}?)\s*$/);
  const dashCandidate = dashMatch ? dashMatch[1].trim() : '';
  const roleWords = ['engineer', 'developer', 'analyst', 'manager', 'scientist', 'architect', 'lead', 'senior', 'junior', 'remote', 'hybrid', 'intern'];
  const dashLooksLikeRole = roleWords.some(w => dashCandidate.toLowerCase().includes(w));

  if (atMatch) {
    company = atMatch[1].trim().replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Corp\.?)$/i, '').trim();
    rawTitle = rawTitle.replace(/\s*[@]\s*.+$/, '').trim();
  } else if (dashMatch && !dashLooksLikeRole && dashCandidate.split(/\s+/).length <= 5) {
    company = dashCandidate.replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Corp\.?)$/i, '').trim();
    rawTitle = rawTitle.replace(/\s*[-–—]\s*[^-–—]+$/, '').trim();
  }

  // Strategy 3: extract from the applyUrl hostname (SmartRecruiters, Greenhouse, etc.)
  if (genericCompanies.includes(company.toLowerCase().trim())) {
    try {
      const urlObj = new URL(applyUrl);
      const host = urlObj.hostname.replace(/^www\./, '');
      // SmartRecruiters: jobs.smartrecruiters.com/CompanyName/...
      // Greenhouse: job-boards.greenhouse.io/companyslug/...
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if ((host.includes('smartrecruiters.com') || host.includes('greenhouse.io')) && pathParts.length >= 1) {
        const slug = pathParts[0].replace(/[-_]+/g, ' ').replace(/\d+$/g, '').trim();
        if (slug.length >= 2) company = slug.charAt(0).toUpperCase() + slug.slice(1);
      } else if (host.includes('ashbyhq.com') && pathParts.length >= 1) {
        const slug = decodeURIComponent(pathParts[0]).replace(/%20/g, ' ').trim();
        if (slug.length >= 2) company = slug;
      }
    } catch (_) { /* invalid URL, skip */ }
  }
}
// Strip the company name from the beginning of the title if present (SmartRecruiters pattern: "CompanyName Job Title")
if (company.length >= 3 && rawTitle.toLowerCase().startsWith(company.toLowerCase())) {
  rawTitle = rawTitle.slice(company.length).replace(/^\s*[-–—:]\s*/, '').trim() || rawTitle;
}
// Also handle "Job Application for X at Company" pattern
const appForMatch = rawTitle.match(/^Job Application for (.+?)(?:\s+at\s+.+)?$/i);
if (appForMatch) rawTitle = appForMatch[1].trim();

const title = rawTitle;

// Official fields — no guessing
const source_job_id = String(job.jobId || '').trim();

const descParts = [title, company, location, job.platform ? `Platform: ${job.platform}` : '', job.searchQuery || ''];
const job_description = descParts.filter(Boolean).join('\n\n');

const jdHash = quickHash12(job_description);
const applicationId = `APP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

return {
  json: {
    application_id: applicationId,
    source_job_id,
    company,
    job_title: title,
    location,
    job_url: applyUrl,
    application_url: applyUrl,
    source: 'apify_job_pulse',
    date_found: new Date().toISOString().split('T')[0],
    date_posted: job.foundAt || '',
    remote_status: 'unknown',
    salary: '',
    job_description,
    jd_hash: jdHash,
  },
};
