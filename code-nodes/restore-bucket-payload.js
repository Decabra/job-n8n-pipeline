// Restore the Score Bucket payload after Mark As Processed wiped it.
//
// Why this exists: `Mark As Processed` is an Airtable side-effect (REST upsert)
// that does not need to carry the full job forward. The full job
// payload — including `bucket`, `fit_score`, `score_raw`, `job_description`,
// and everything Switch Bucket and the packet branch need — gets dropped.
// Without this restoration, Switch Bucket reads `$json.bucket` = undefined
// and routes EVERY item to the fallback, making the packet branch
// completely unreachable. Symptom: jobs scoring 86, 90, 92 still get
// looped back to Split Jobs as if they were rejects.
//
// Same pattern as deserialize / index bridges: the upsert is a side-effect
// node; we re-pull the upstream payload from `Score Bucket` so downstream
// nodes see the data they actually need.
//
// Inside the splitInBatches loop, `$('Score Bucket').all()` returns the
// current iteration's output (one item) because Score Bucket re-executes
// each iteration; n8n's node-reference data is scoped to the most recent
// execution of that node within the current run context.
return $('Score Bucket').all();
