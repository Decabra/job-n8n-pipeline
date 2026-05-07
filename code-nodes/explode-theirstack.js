// TheirStack POST /v1/jobs/search returns { data: [...], metadata: {...} }
const root = $input.first().json;
const d = root.data;
if (!Array.isArray(d)) return [];
return d.map((row) => ({ json: row }));
