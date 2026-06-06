const j = $json && typeof $json === 'object' ? $json : {};
const cfg = $('Config').first().json;

function cleanMultiline(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const tailoredResume = cleanMultiline(j.tailored_resume_md || '').slice(0, 6000);
const jd = cleanMultiline(j.job_description || '').slice(0, 8000);
const fitSummary = cleanMultiline(j.fit_summary || '');
const atsKeywords = (j.ats_keywords_added || []).join(', ');

const NAME_MAX = 80;
const CONTACT_MAX = 200;

let candidateName = String(cfg.candidate_name || '').trim();
let contactLine = String(cfg.candidate_contact_line || '').trim();

if (!candidateName) {
  const baseResume = String(cfg.base_resume_text || '');
  const headLines = baseResume.split('\n').slice(0, 10);
  for (const ln of headLines) {
    const m = ln.match(/^#\s+(.{1,80}?)\s*$/);
    if (m) {
      candidateName = m[1].trim();
      break;
    }
  }
}

candidateName = candidateName.slice(0, NAME_MAX) || 'Applicant';
contactLine = contactLine.slice(0, CONTACT_MAX);

const todayLong = new Date().toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const system = `You write cover letters that sound like a real person typed them in 10 minutes, not like a template engine filled in blanks.

VOICE:
- Write like you talk to a colleague, then clean it up one notch for a hiring manager.
- Short sentences. Mix in a longer one when it earns it. Vary rhythm.
- Contractions are fine. "I've built" not "I have built." "That's why" not "That is why."
- Active voice always. "I built X" not "X was built by me."
- Be direct. Say what you did, say why it matters here, stop.
- No filler. If a sentence can be cut without losing meaning, cut it.

WHAT MAKES IT HUMAN:
- A human connects their specific work to this specific company's problem. Not generic praise.
- A human picks ONE story and tells it with enough detail that the reader pictures the work.
- A human does not list 5 accomplishments in 3 sentences. That's a resume, not a letter.
- A human sounds confident without saying "I am confident." Show it through specifics.

NEVER USE THESE PHRASES:
"I believe I would be a great fit", "I am excited to apply", "I am writing to express my interest", "my passion for", "self-starter", "team player", "go-getter", "results-driven", "thought leader", "synergy", "proven track record", "cutting-edge", "best-in-class", "in order to", "leveraging", "utilizing", "spearheading", "orchestrating", "I look forward to hearing from you", "please do not hesitate to contact me", "I am confident that", "I would welcome the opportunity", "dynamic environment", "fast-paced environment", "hit the ground running"`;

const user = `Write the BODY of a cover letter. The letterhead (name, contact) is added by the system. Output ONLY: date, salutation, body paragraphs, closing, signature.

CANDIDATE: ${candidateName}
COMPANY: ${j.company}
ROLE: ${j.job_title}
LOCATION: ${j.location}
DATE: ${todayLong}

FIT SUMMARY (use for positioning):
${fitSummary}

ATS KEYWORDS: ${atsKeywords}

TAILORED RESUME (every claim must trace back here, do not invent):
${tailoredResume}

JOB DESCRIPTION:
${jd}

STRUCTURE (exactly 3 paragraphs, no more):

1. HOOK (2-3 sentences): Open with something specific about THIS company, their product, or a problem from the JD. Then connect it to what you are building right now. The reader should think "this person actually looked at what we do." Do NOT open with "I am writing to apply" or any variant.

2. PROOF (3-4 sentences): Pick ONE achievement from the resume that maps to the role's biggest requirement. Tell the story: what was the problem, what did you do, what was the result. Use real numbers from the resume. This is the paragraph that makes the reader stop skimming.

3. CLOSE (1-2 sentences): Say what interests you about working on this specific team or product. End with a line that implies a conversation, not begging. No "I look forward to hearing from you."

HARD RULES:
- 150 to 200 words for the body. Not 250+. If it's over, you wrote filler. Cut it.
- Single page. Always.
- No fabricating projects, metrics, employers, dates, or credentials. Every fact comes from the resume above.
- Do not repeat resume bullets verbatim. The letter tells the story behind one bullet.
- No em dashes inside paragraphs. Use commas or periods.
- Do not add a P.S. or any extra sections.

OUTPUT FORMAT: raw markdown only. No JSON. No code fences. No preamble. No placeholder brackets like [Hook]. Write the full letter. Start with the date on line 1, then Dear ..., then three real paragraphs, then Sincerely, then your name.`;

const azure_body = {
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ],
  // gpt-5.5 / reasoning deployments charge reasoning tokens against this cap;
  // 2500 was too low and produced empty message.content (parse then failed).
  max_completion_tokens: 6000,
};

return {
  json: {
    ...j,
    azure_body,
    _cl_letterhead: { candidateName, contactLine },
  },
};
