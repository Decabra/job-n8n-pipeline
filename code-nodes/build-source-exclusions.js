// Build exclusion lists for the pipeline from the Source Job Index table.
// Goal: avoid spending fetch credits AND Azure scoring tokens on jobs we have
// already PROCESSED in a prior run, regardless of whether they became packets
// or got rejected by scoring.
//
// Outcome semantics — only PROCESSED rows are exclusions:
//   • outcome = 'PROCESSED' → scoring completed (packet OR rejected)
//                              → safe to skip; this list excludes them.
//   • outcome = 'FETCHED'   → indexed at fetch time but the loop didn't
//                              finish scoring it (crash, timeout, partial
//                              run). NOT excluded — eligible for retry next
//                              run so we don't lose jobs to mid-loop crashes.
//
// Three outputs feed consumers:
//   1. `theirstack_job_id_not` — TheirStack `job_id_not` (server-side exclusion).
//   2. `fantastic_job_id_not` — Fantastic Apify `idExclusionFilter` (same intent;
//      actor input schema documents *ExclusionFilter fields; id list is passed
//      through — verify on Apify run logs). Capped at FANTASTIC_MAX_IDS.
//      Post-fetch belt-and-suspenders: filter-fantastic-exploded.js.
//   3. `excluded_keys` — Set-style array of `${source}::${source_job_id}`
//      strings spanning ALL sources (jsearch, apify_fantastic_jobs, theirstack,
//      and any future source). Consumed by `Filter & Dedupe Incoming` after
//      the merge to drop already-processed jobs before they hit Azure scoring.
const indexRows = $('Airtable List Source Job Index')
  .all()
  .map((i) => i.json || {});

const THEIRSTACK_MAX_IDS = 500;
const FANTASTIC_MAX_IDS = 2000;
const theirstackSeen = new Set();
const theirstackIds = [];
const fantasticSeen = new Set();
const fantasticIds = [];
const excludedKeys = new Set();
const bySource = Object.create(null);
const byOutcome = { PROCESSED: 0, FETCHED: 0, OTHER: 0 };

for (const row of indexRows) {
  const source = String(row.source || '').trim().toLowerCase();
  const sid = String(row.source_job_id || '').trim();
  const outcome = String(row.outcome || '').trim().toUpperCase();
  if (!source || !sid) continue;

  if (outcome === 'PROCESSED') byOutcome.PROCESSED++;
  else if (outcome === 'FETCHED') byOutcome.FETCHED++;
  else byOutcome.OTHER++;

  // Skip non-PROCESSED rows entirely — those are pending retries.
  if (outcome !== 'PROCESSED') continue;

  bySource[source] = (bySource[source] || 0) + 1;

  // Universal exclusion key: matched against incoming items by Filter &
  // Dedupe Incoming. `${source}::${sid}` keeps source-namespaced so JSearch
  // and TheirStack can never collide on numerically similar IDs.
  excludedKeys.add(`${source}::${sid}`);

  // TheirStack-specific list, capped because the API enforces a payload limit.
  if (source === 'theirstack' && theirstackIds.length < THEIRSTACK_MAX_IDS) {
    if (!theirstackSeen.has(sid)) {
      theirstackSeen.add(sid);
      theirstackIds.push(sid);
    }
  }

  if (source === 'apify_fantastic_jobs' && fantasticIds.length < FANTASTIC_MAX_IDS) {
    if (!fantasticSeen.has(sid)) {
      fantasticSeen.add(sid);
      fantasticIds.push(sid);
    }
  }
}

return [{
  json: {
    theirstack_job_id_not: theirstackIds,
    fantastic_job_id_not: fantasticIds,
    excluded_keys: Array.from(excludedKeys),
    _exclusion_stats: {
      from_index: indexRows.length,
      by_outcome: byOutcome,
      by_source_processed: bySource,
      excluded_keys_count: excludedKeys.size,
      theirstack_unique: theirstackIds.length,
      theirstack_capped_at: THEIRSTACK_MAX_IDS,
      fantastic_unique: fantasticIds.length,
      fantastic_capped_at: FANTASTIC_MAX_IDS,
    },
  },
}];
