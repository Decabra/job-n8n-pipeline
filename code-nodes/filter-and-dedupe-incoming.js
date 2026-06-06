// Single gate for everything between merge and the scoring loop.
//
// Ten drop rules, one iteration, one source of truth for "is this item
// worth processing?" Every surviving item is guaranteed to have a non-empty
// source_job_id AND source, which is the contract Index All Fetched Jobs
// and the rest of the pipeline rely on.
//
// Drop order (cheapest checks first):
//   1. Missing source_job_id → can't be tracked across runs, can't be
//      indexed (would corrupt the index by upserting against blank).
//   2. Missing source         → defensive; every normalizer sets this.
//   3. Blocked domain         → pay-to-apply aggregators (bebee, recruit.net, …).
//   4. Stale (>24h old)       → belt-and-suspenders for JSearch / Fantastic.
//                               Skipped for TheirStack: the search request already
//                               sets posted_at_max_age_days, and date-only
//                               date_posted values parse at noon UTC so same-day
//                               API results were incorrectly dropped as "stale".
//   5. Already PROCESSED      → in the Source Job Index from a prior run
//                               that completed scoring (saves Azure tokens).
//   6. Senior title           → mirrors score-bucket title_seniority_fit gate.
//   7. Visa/citizenship block → mirrors score-bucket visa_safety gate.
//   8. Thin JD (<50 words)    → mirrors score-bucket posting_quality gate.
//   9. Cross-source duplicate → same company+title+location from another source.
//  10. Within-batch duplicate → same `${source}::${source_job_id}` in this run.
//
// Items with empty `date_posted` skip the stale check (sources sometimes
// don't include a posted date; let scoring see them). Items carrying the
// `_retry_from_index: true` flag (replayed by Pull Stale FETCHED) ALSO
// skip the stale and thin-JD checks — they're known FETCHED-but-unprocessed
// jobs from prior runs. They still go through every other drop rule.
const exclData = $('Build Source Exclusions').first().json || {};
const excludedKeys = new Set(
  Array.isArray(exclData.excluded_keys) ? exclData.excluded_keys : [],
);

const SENIOR_TITLE_RE = /\b(staff|principal|distinguished|director|head\s+of|VP|vice\s+president)\b/i;
const VISA_BLOCKER_RE = /(security\s+clearance|TS\/SCI|polygraph|public\s+trust|US\s+citizens?\s+only|must\s+be\s+a\s+US\s+citizen|citizenship\s+required|no\s+visa\s+sponsorship|without\s+(current\s+or\s+future\s+)?sponsorship)/i;

function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function canonicalKey(job) {
  const company = String(job.company || '')
    .toLowerCase()
    .replace(/[,.]/g, '')
    .replace(/\b(inc|llc|ltd|corp|co|company|gmbh|sa)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = String(job.job_title || '')
    .toLowerCase()
    .replace(/[()\[\]\/,]/g, ' ')
    .replace(/\b(remote|hybrid|on.?site|us|usa|united states)\b/g, '')
    .replace(/\b(i|ii|iii|iv|v|l[1-9])\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const loc = job.remote_status === 'remote'
    ? 'remote'
    : String(job.location || '').toLowerCase().split(',')[0].trim();
  return `${company}::${title}::${loc}`;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

const items = $input.all();
const seen = new Set();
const seenCanon = new Set();
const out = [];

const stats = {
  in: items.length,
  dropped_no_id: 0,
  dropped_no_source: 0,
  dropped_blocked_domain: 0,
  dropped_stale: 0,
  dropped_stale_by_source: Object.create(null),
  dropped_excluded: 0,
  dropped_senior_title: 0,
  dropped_visa_blocked: 0,
  dropped_thin_jd: 0,
  dropped_cross_source_dup: 0,
  dropped_duplicate: 0,
  retry_passed: 0,
  dropped_by_source: Object.create(null),
};

for (const item of items) {
  const job = item.json || {};

  const sid = String(job.source_job_id || '').trim();
  if (!sid) {
    stats.dropped_no_id++;
    continue;
  }

  const src = String(job.source || '').trim().toLowerCase();
  if (!src) {
    stats.dropped_no_source++;
    continue;
  }

  if (isBlockedNormalizedJob(job)) {
    stats.dropped_blocked_domain++;
    stats.dropped_by_source[src] = (stats.dropped_by_source[src] || 0) + 1;
    continue;
  }

  const isRetry = job._retry_from_index === true;
  // TheirStack POST already passes posted_at_max_age_days; redundant 24h gate
  // here burned paid credits (8/10 dropped in a typical run).
  const skipStaleCheck = isRetry || src === 'theirstack';

  const dp = job.date_posted || '';
  if (dp && !skipStaleCheck) {
    // Date-only timestamps (YYYY-MM-DD) parse at midnight UTC and look stale
    // too early near a day boundary; bias to midday UTC so same-day postings
    // aren't dropped incorrectly.
    const posted = String(dp).includes('T')
      ? new Date(dp).getTime()
      : new Date(`${dp}T12:00:00Z`).getTime();
    if (!isNaN(posted) && now - posted > MAX_AGE_MS) {
      stats.dropped_stale++;
      stats.dropped_stale_by_source[src] = (stats.dropped_stale_by_source[src] || 0) + 1;
      continue;
    }
  }

  const identityKey = `${src}::${sid}`;

  if (excludedKeys.has(identityKey)) {
    stats.dropped_excluded++;
    stats.dropped_by_source[src] = (stats.dropped_by_source[src] || 0) + 1;
    continue;
  }

  const titleStr = String(job.job_title || '');
  if (SENIOR_TITLE_RE.test(titleStr)) {
    stats.dropped_senior_title++;
    continue;
  }

  const descStr = String(job.job_description || '');
  if (VISA_BLOCKER_RE.test(descStr)) {
    stats.dropped_visa_blocked++;
    continue;
  }

  if (wordCount(descStr) < 50 && !isRetry) {
    stats.dropped_thin_jd++;
    continue;
  }

  const canon = canonicalKey(job);
  if (seenCanon.has(canon)) {
    stats.dropped_cross_source_dup++;
    continue;
  }
  seenCanon.add(canon);

  if (seen.has(identityKey)) {
    stats.dropped_duplicate++;
    continue;
  }
  seen.add(identityKey);

  if (isRetry) stats.retry_passed++;

  out.push(item);
}

stats.passed = out.length;
stats.passed_by_source = Object.create(null);
for (const item of out) {
  const s = String(item.json?.source || '').trim().toLowerCase();
  if (s) stats.passed_by_source[s] = (stats.passed_by_source[s] || 0) + 1;
}

// Stamp diagnostic stats on the first surviving item so they're visible in
// n8n's run inspector. Downstream nodes ignore the field.
if (out.length > 0) {
  out[0] = {
    ...out[0],
    json: { ...out[0].json, _filter_stats: stats },
  };
}

return out;
