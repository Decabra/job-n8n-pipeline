const root = $json && typeof $json === 'object' ? $json : {};
const raw = root.choices?.[0]?.message?.content || root.message?.content || root.content || '{}';

let parsed;
try {
  const m = String(raw).match(/\{[\s\S]*\}/);
  parsed = JSON.parse(m ? m[0] : raw);
} catch (e) {
  parsed = {
    fit_score: 0,
    reasoning: 'Failed to parse LLM response',
    red_flags: ['parse_error'],
    visa_risk: 'unknown',
    rejection_reason: String(e),
  };
}

const prev = $('Prepare Azure Score Body').first().json;

return {
  json: {
    ...prev,
    fit_score: Number(parsed.fit_score) || 0,
    reasoning: parsed.reasoning || '',
    red_flags: parsed.red_flags || [],
    visa_risk: parsed.visa_risk || 'unknown',
    rejection_reason: parsed.rejection_reason ?? null,
    score_raw: parsed,
  },
};
