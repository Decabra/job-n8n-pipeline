// Pull stale FETCHED items from the Source Job Index for proactive retry.
//
// Why this exists: items get indexed as FETCHED when first pulled and only
// flipped to PROCESSED after scoring completes. If the loop crashes mid-
// iteration (Azure timeout, parse error, network blip, n8n restart), the
// affected items stay at FETCHED. Without this node, retry depends on
// whether the source APIs return them AGAIN on the next run — which they
// usually don't because every source we use filters to ≤1 day of postings.
// Result: FETCHED zombies accumulate and high-quality jobs are silently
// lost between runs.
//
// What this node does: reads the same `Airtable List Source Job Index`
// snapshot that `Build Source Exclusions` consumes, keeps only FETCHED
// rows that have a stored `payload_json`, and deserializes the payload
// back into the canonical job shape the source normalizers emit. Output
// items merge into `Merge All Job Sources` as a third input alongside
// fresh items from JSearch / Apify / TheirStack.
//
// Why double-processing isn't a concern in the same run:
//   1. n8n executes `Airtable List Source Job Index` ONCE early in the
//      workflow, before `Index All Fetched Jobs` runs. The snapshot we
//      read here is taken BEFORE this run writes its own FETCHED rows,
//      so we can never accidentally retry items we just fetched.
//   2. `Filter & Dedupe Incoming` dedupes by `${source}::${source_job_id}`
//      and the merge appends in input order (fresh sources first, this
//      branch last) — so when a fresh source ALSO returns a stuck FETCHED
//      job, the fresh copy wins and the retry copy is dropped silently.
//
// Items get a `_retry_from_index: true` flag so `Filter & Dedupe Incoming`
// can skip its date_posted staleness check (the original posting may be
// days old by now; we still want to retry it). Everything else flows
// through the normal pipeline: scoring, bucketing, Mark As Processed
// (which flips outcome FETCHED → PROCESSED). On success the zombie is
// gone; on failure it stays FETCHED for the next run.
//
// Items WITHOUT a payload_json (FETCHED rows from runs before this field
// was added, or where indexing partially failed) are silently dropped —
// nothing to replay. The diagnostic stats stamped on the first surviving
// item make those visible in the n8n run inspector.
const indexRows = $('Airtable List Source Job Index')
  .all()
  .map((i) => i.json || {});

const out = [];
const stats = {
  index_rows: indexRows.length,
  fetched_rows: 0,
  retried: 0,
  dropped_no_payload: 0,
  dropped_bad_json: 0,
  dropped_missing_id: 0,
};

for (const row of indexRows) {
  const outcome = String(row.outcome || '').trim().toUpperCase();
  if (outcome !== 'FETCHED') continue;
  stats.fetched_rows++;

  const raw = row.payload_json;
  if (!raw) {
    stats.dropped_no_payload++;
    continue;
  }

  let payload;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    stats.dropped_bad_json++;
    continue;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    stats.dropped_bad_json++;
    continue;
  }

  // The replay payload must have a source_job_id (otherwise the rest of
  // the pipeline can't track it). If the stored payload is missing it,
  // back-fill from the index row — they're the same value by definition,
  // it's just defensive against a corrupted stringification.
  const sid = String(payload.source_job_id || row.source_job_id || '').trim();
  const src = String(payload.source || row.source || '').trim();
  if (!sid || !src) {
    stats.dropped_missing_id++;
    continue;
  }
  payload.source_job_id = sid;
  payload.source = src;

  out.push({
    json: {
      ...payload,
      _retry_from_index: true,
    },
  });
  stats.retried++;
}

if (out.length > 0) {
  out[0] = {
    ...out[0],
    json: { ...out[0].json, _retry_stats: stats },
  };
}

return out;
