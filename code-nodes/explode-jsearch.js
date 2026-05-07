// After HTTP JSearch — one item with { data: [...] }
const root = $input.first().json;
const data = root.data ?? [];
if (!Array.isArray(data)) {
  return [];
}
return data.map((job) => ({ json: job }));
