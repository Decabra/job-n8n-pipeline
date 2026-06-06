const root = $json && typeof $json === 'object' ? $json : {};
const raw = root.choices?.[0]?.message?.content || '{}';

let parsed;
try {
  const m = String(raw).match(/\{[\s\S]*\}/);
  parsed = JSON.parse(m ? m[0] : raw);
} catch (e) {
  parsed = {
    tailored_resume_md: '# Error\nCould not parse tailoring response.',
    fit_summary: '',
    key_resume_changes: [],
    visa_notes: '',
    ats_keywords_added: [],
  };
}

const prev = $('Prepare Azure Tailor Body').item.json;

return {
  json: {
    ...prev,
    tailored_resume_md: parsed.tailored_resume_md || '',
    fit_summary: parsed.fit_summary || '',
    key_resume_changes: parsed.key_resume_changes || [],
    visa_notes: parsed.visa_notes || '',
    ats_keywords_added: parsed.ats_keywords_added || [],
  },
};
