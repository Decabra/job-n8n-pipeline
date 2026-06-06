// Pay-to-apply / scam job aggregators — single source of truth.
// Consumed at embed time (Fantastic / TheirStack / JSearch API params) and
// prepended to Filter & Dedupe Incoming via withBlocked() in embed-workflows.mjs.
const BLOCKED_JOB_DOMAINS = [
  'bebee.com',
  'www.bebee.com',
  'recruit.net',
  'www.recruit.net',
  'jobleads.com',
  'www.jobleads.com',
];

// Hosts without www — used by TheirStack url_domain_not (substring match).
const BLOCKED_URL_DOMAIN_NOT = [
  'bebee.com',
  'recruit.net',
  'jobleads.com',
];

// JSearch exclude_job_publishers — job_publisher labels, not hostnames.
// Add aliases if a run shows a different job_publisher string for the same board.
const JSEARCH_EXCLUDED_PUBLISHERS = [
  'BeeBe',
  'beBee',
  'Recruit.net',
  'JobLeads',
];

function blockedHostFromUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return s.toLowerCase().replace(/^www\./, '').split('/')[0];
  }
}

function isBlockedJobHost(hostOrUrl) {
  const host = blockedHostFromUrl(hostOrUrl);
  if (!host) return false;
  return BLOCKED_JOB_DOMAINS.some((d) => {
    const blocked = d.toLowerCase().replace(/^www\./, '');
    return host === blocked || host.endsWith(`.${blocked}`);
  });
}

function isBlockedNormalizedJob(job) {
  const j = job && typeof job === 'object' ? job : {};
  return (
    isBlockedJobHost(j.job_url)
    || isBlockedJobHost(j.application_url)
    || isBlockedJobHost(j.company)
  );
}
