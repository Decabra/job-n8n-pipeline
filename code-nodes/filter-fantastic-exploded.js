// Drop Fantastic.jobs rows already PROCESSED (idExclusionFilter belt-and-suspenders).
// Runs before normalize so we skip mapping junk that Filter & Dedupe would drop
// anyway via excluded_keys — saves normalize work, not Apify credits (those are
// saved by domainExclusionFilter on the actor input). Pay-to-apply domains are
// dropped only in Filter & Dedupe Incoming (all sources).
const excl = $('Build Source Exclusions').first().json || {};
const ids = new Set(
  (Array.isArray(excl.fantastic_job_id_not) ? excl.fantastic_job_id_not : []).map((x) =>
    String(x || '').trim(),
  ).filter(Boolean),
);

const items = $input.all();
const out = [];
const stats = {
  in: items.length,
  dropped_index_excluded: 0,
  passed: 0,
  exclusion_ids_available: ids.size,
};

for (const item of items) {
  const row = item.json || {};
  if (row._apify_skip) {
    out.push(item);
    continue;
  }
  const id = String(row.id || '').trim();
  if (id && ids.has(id)) {
    stats.dropped_index_excluded++;
    continue;
  }
  out.push(item);
}

stats.passed = out.length;
if (out.length > 0) {
  out[0] = {
    ...out[0],
    json: { ...out[0].json, _fantastic_prefilter_stats: stats },
  };
}

return out;
