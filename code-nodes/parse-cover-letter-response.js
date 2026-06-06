// Parse the Azure cover-letter response and stitch it onto the letterhead.
//
// We deliberately ask the LLM for RAW MARKDOWN (no JSON wrapper) — see the
// prompt in `prepare-azure-cover-letter-body.js` for why. Wrapping a
// multi-line markdown body inside a JSON string is fragile: LLMs miss \n
// escapes, leak un-escaped quotes when company names contain them, and on
// reasoning-model deployments truncate mid-string when the completion-token
// budget is consumed by reasoning. The previous JSON-wrapped contract
// silently emitted an "Error" body that flowed through Build Packet →
// Convert PDF → Upload, producing a polished-looking junk PDF that you
// only discovered AFTER it landed on your desktop.
//
// New contract:
//   1. Take Azure's response content as-is.
//   2. Strip optional code-fence wrapping (```markdown ... ``` or ``` ... ```)
//      in case the LLM disobeyed and wrapped anyway.
//   3. Strip common preamble lines ("Here is the cover letter:", etc.).
//   4. Strip a leading H1 / candidate-name line if the LLM emitted its own
//      letterhead (we add it programmatically below).
//   5. If the body is empty OR missing the required structural anchors
//      (a date line and a salutation), THROW with the raw response in the
//      error so the failure surfaces in n8n's executions panel instead of
//      becoming a junk PDF.
const root = $json && typeof $json === 'object' ? $json : {};
const choice = root.choices?.[0] || {};
const msg = choice.message || {};
const raw = String(msg.content ?? '').trim();
const finishReason = String(choice.finish_reason || '');
const refusal = String(msg.refusal || '').trim();

if (refusal) {
  throw new Error(`[Parse Cover Letter] Azure refused: ${refusal}`);
}

let body = raw;

// Strip outer code fence if present: ```markdown\n...\n``` or ```\n...\n```
const fenceMatch = body.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/);
if (fenceMatch) {
  body = fenceMatch[1].trim();
}

// Strip a one-line preamble like "Here's the cover letter:" / "Sure, here you go:"
// that some models add despite instructions. Cap at 100 chars to avoid
// stripping something legitimate.
const preambleMatch = body.match(/^(?:here(?:'s| is)|sure[,!]?\s+here(?:'s| is)?|certainly[,!]?\s+here(?:'s| is)?)[^\n]{0,100}\n+/i);
if (preambleMatch) {
  body = body.slice(preambleMatch[0].length).trim();
}

const prev = $('Prepare Azure Cover Letter Body').item.json;
const lh = prev._cl_letterhead || {};
const candidateName = lh.candidateName || 'Applicant';
const contactLine = lh.contactLine || '';

// Defensive scrubs in case the LLM disobeyed and emitted its own letterhead
// (we always prepend ours below). Cap regex blast radius at 200 chars.
body = body.replace(/^#\s+.{0,200}\n+/, '');

const nl = body.indexOf('\n');
if (nl > 0 && nl < 120) {
  const firstLine = body.slice(0, nl).trim();
  if (firstLine.toLowerCase() === candidateName.toLowerCase()) {
    body = body.slice(nl + 1).replace(/^\n+/, '');
  }
}

body = body.replace(/^---+\s*\n+/, '');

// Sanity gates — both must hold or this isn't a usable cover letter.
// Throw with the raw response so the executions panel shows what Azure
// actually returned, instead of producing a junk PDF.
const hasSalutation = /(^|\n)\s*Dear\b/i.test(body);
const minLen = body.length >= 80;

if (!body || !hasSalutation || !minLen) {
  const preview = raw.length > 1500 ? raw.slice(0, 1500) + '\n…[truncated]' : raw;
  const emptyHint =
    raw.length === 0
      ? ` Azure returned empty message.content (finish_reason=${finishReason || 'unknown'}). ` +
        'If using a reasoning model, raise max_completion_tokens on Prepare Azure Cover Letter Body.'
      : '';
  throw new Error(
    `[Parse Cover Letter] Azure response is not a usable cover letter.${emptyHint} ` +
    `Body length after cleanup: ${body.length} chars. ` +
    `Has "Dear" salutation: ${hasSalutation}. ` +
    `Raw Azure content (${raw.length} chars):\n<<<\n${preview || '(empty)'}\n>>>`,
  );
}

// Stitch: letterhead (matches resume H1) + optional contact line + divider + body.
const letterheadParts = [`# ${candidateName}`];
if (contactLine) letterheadParts.push('', contactLine);
letterheadParts.push('', '---', '');

const cover_letter_md = letterheadParts.join('\n') + body;

return {
  json: {
    ...prev,
    cover_letter_md,
  },
};
