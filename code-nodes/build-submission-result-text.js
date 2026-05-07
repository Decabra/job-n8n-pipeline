const v = $('Validate Submission').item.json;
const c = $('Classify ATS').item.json;
const f = $('Airtable Load App').item.json.fields || {};

const lines = [
  'submission_result',
  `timestamp=${new Date().toISOString()}`,
  `ok=${v.ok}`,
  `errors=${JSON.stringify(v.errors || [])}`,
  `blocker=${c.blocker}`,
  `submission_mode=${c.submission_mode}`,
  `application_id=${v.application_id}`,
  `application_url=${f.application_url || ''}`,
  `resume_link=${f.resume_link || ''}`,
  'note=MVP executor does not auto-submit; human applies with these links.',
];

return { json: { result_text: lines.join('\n') } };
