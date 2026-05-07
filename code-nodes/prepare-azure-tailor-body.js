const j = $json && typeof $json === 'object' ? $json : {};
const cfg = $('Config').first().json;

function cleanMultiline(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const baseResume = cleanMultiline(
  cfg.base_resume_text ||
    'REPLACE_ME: Paste your resume into the Config node base_resume_text field.',
);

const jd = cleanMultiline(j.job_description || '').slice(0, 12000);

const user = `You are a resume tailoring engine. Given a base resume and a job description, produce a tailored resume.

STRICT RULES:
- Do NOT fabricate employers, dates, metrics, tools, degrees, publications, or credentials.
- Do NOT invent experience the candidate does not have.
- You MAY reorder bullets, adjust emphasis, add relevant keywords from the JD, rephrase for clarity.
- Do NOT add a Summary, Objective, or any section that does not exist in the base resume.
- Do NOT add new sections. Tailoring is rephrasing and reordering only, not expanding structure.
- Optimize for ATS keyword matching.
- Preserve the candidate's real background exactly.

LENGTH GUIDELINES:
- Aim for a concise, readable resume. Quality over quantity — recruiters skim in seconds.
- Keep a similar length to the base resume. If you add keywords or content, trim less-relevant text to compensate.
- Stick to the number of bullets in the base resume per role. Rephrase weak bullets rather than adding new ones.
- Skills: keep the base format and swap keywords in/out according to the JD.
- Do NOT pad with filler. Every line should earn its place.

Base resume:
${baseResume}

Job description:
${jd}

Company: ${j.company}
Title: ${j.job_title}

Return ONLY valid JSON:
{
  "tailored_resume_md": "<full tailored resume in markdown>",
  "fit_summary": "<2-3 sentences: (1) why this role is worth applying to given the candidate's profile, (2) how the candidate's experience directly aligns, (3) what makes the candidate stand out vs typical applicants>",
  "key_resume_changes": ["<SECTION: before → after or concrete edit, e.g. 'Skills: moved Python, LLM, RAG before generic web stack' or 'Role X: replaced generic bullet with JD keyword: vector search / embeddings'>"],
  "visa_notes": "<OPT/sponsorship considerations>",
  "cover_letter": "<optional cover letter or null>",
  "ats_keywords_added": ["<kw1>"]
}`;

const azure_body = {
  messages: [{ role: 'user', content: user }],
  max_completion_tokens: 4000,
};

return { json: { ...j, azure_body } };
