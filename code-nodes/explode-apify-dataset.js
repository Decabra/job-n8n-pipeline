// After GET Apify dataset items.
// n8n HTTP Request often splits a JSON array body into ONE n8n item per row — each item's
// json is already a single job object. Older path assumed one item wrapping an array.
const items = $input.all();
if (!items.length) return [];

const first = items[0].json;
if (first && first._apify_skip) return [];

if (Array.isArray(first)) {
  return first.map((row) => ({ json: row }));
}
if (first && Array.isArray(first.body)) {
  return first.body.map((row) => ({ json: row }));
}
if (first && Array.isArray(first.data)) {
  return first.data.map((row) => ({ json: row }));
}

return items
  .map((i) => i.json)
  .filter((row) => row && typeof row === 'object' && !row._apify_skip)
  .map((row) => ({ json: row }));
