// NOTE: ALL_STATUSES is injected from _statuses.js by embed-workflows.mjs.
const items = $input.all();
const counts = {};
for (const s of ALL_STATUSES) counts[s] = 0;
counts._unknown = 0;

for (const item of items) {
  const f = item.json.fields || item.json;
  const s = String(f.status || '').toUpperCase();
  if (counts[s] !== undefined) counts[s]++;
  else counts._unknown++;
}

const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
const lines = [`--- Pipeline report (${now}) ---`, `Rows: ${items.length}`];
for (const s of ALL_STATUSES) lines.push(`${s}: ${counts[s]}`);
if (counts._unknown) lines.push(`UNKNOWN: ${counts._unknown}`);

return [{ json: { report_text: lines.join('\n'), stats: counts } }];
