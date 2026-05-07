// Drop jobs whose date_posted is older than the configured freshness window.
// Keeps jobs where date_posted is missing (let scoring decide).
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const now = Date.now();
const items = $input.all();
const results = [];

for (const item of items) {
  const job = item.json || {};
  const dp = job.date_posted || '';
  if (!dp) {
    results.push(item);
    continue;
  }
  let posted;
  if (String(dp).includes('T')) {
    posted = new Date(dp).getTime();
  } else {
    // Date-only timestamps (YYYY-MM-DD) parse at midnight UTC and can look stale too early.
    // Bias to midday UTC so same-day postings are not incorrectly dropped.
    posted = new Date(`${dp}T12:00:00Z`).getTime();
  }
  if (isNaN(posted) || (now - posted) <= MAX_AGE_MS) {
    results.push(item);
  }
}

return results;
