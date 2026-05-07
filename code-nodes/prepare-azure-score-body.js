const j = $json && typeof $json === 'object' ? $json : {};
const cfg = $('Config').first().json;
function cleanMultiline(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const jd = cleanMultiline(j.job_description || '').slice(0, 8000);
const resume = cleanMultiline(cfg.base_resume_text || '').slice(0, 12000);

const user = `You are a job-fit scoring engine. You will be given a candidate's resume and a job description.
Your job is to score how well this specific job aligns with the candidate's current role,
skills, career trajectory, and strongest positioning.

STEP 1 — Analyze the resume (do not output this analysis; use it internally only):
- Identify the candidate's CURRENT ROLE and what they are building day-to-day
- Identify their PRIMARY skill cluster (the domain they are deepest in right now)
- Identify their CAREER TRAJECTORY (where they are heading based on recent roles, publications, projects)
- Identify SECONDARY skills (things they can do but are not their current focus)

STEP 2 — Score the job on these dimensions (each score must be an integer; subscores must sum to fit_score):

1. role_alignment (0-35): How closely does this job match what the candidate is CURRENTLY doing? Near-identical role at a similar or better company = 30-35. Adjacent role using similar tech = 20-29. Tangentially related = 10-19. Unrelated to current work = 0-9.

2. skill_overlap (0-20): How much of the candidate's PRIMARY skills does the JD require? Strong partial overlap (about 60%+) with adjacent skills = high. Do not penalize missing nice-to-have bullets.

3. title_seniority_fit (0-15): Does the title and seniority match the candidate's ~4 years of professional experience?
   HARD RULES (non-negotiable):
   - If the JD explicitly requires 7+ years of experience → score 0 for this dimension (the candidate CANNOT meet the requirement).
   - Staff Engineer, Principal Engineer, Distinguished Engineer, Director, VP, Head of, Lead (8+ YoE implied) → score 0-2.
   - Senior roles requiring 5-6 YoE → score 5-8 (stretch but possible).
   - Mid-level roles (2-5 YoE) → score 12-15 (sweet spot).
   - Entry/junior roles → score 8-10 (overqualified but acceptable).
   Read the ACTUAL years-of-experience requirement from the JD text. Do NOT guess — if the JD says "8+ years" the candidate does not qualify regardless of skill overlap.

4. visa_safety (0-10): Score LOW if ANY of these appear in the JD (non-negotiable):
   - "No visa sponsorship" / "must be authorized to work without sponsorship" / "without current or future sponsorship" → score 0.
   - "US citizens only" / "must be a US citizen" / "citizenship required" → score 0.
   - Security clearance required (TS/SCI, Secret, Top Secret, polygraph, Public Trust) → score 0.
   - Role is physically located OUTSIDE the United States (UK, Philippines, India, Europe, etc.) → score 0.
   If SILENT on sponsorship/visa/citizenship and the role is US-based, score 8. If sponsorship is mentioned positively, score 10.

5. posting_quality (0-10): Is the JD clear, detailed, and credible?
   - If the description contains FEWER THAN 50 WORDS of actual job-related content (responsibilities, requirements, tech stack), score 0-2. A description that is just a title, company name, location, and platform name is NOT a real JD.
   - A complete JD with responsibilities, requirements, and tech stack = 7-10.
   - A sparse but legitimate JD with some detail = 4-6.
   - Vague, spammy, or fake-looking postings = 0-3.

6. career_trajectory (0-10): Does this role advance the candidate's career in AI/LLM/agent engineering?
   - Roles centered on AI agents, LLMs, RAG, ML engineering, or applied AI = 7-10.
   - Roles that are pure Data Engineering, BI/Analytics, DevOps, or traditional backend with no AI component = 0-3 (these pull AWAY from the candidate's strongest trajectory).
   - Adjacent roles with some AI overlap = 4-6.

fit_score must equal role_alignment + skill_overlap + title_seniority_fit + visa_safety + posting_quality + career_trajectory (max 100).

Candidate resume:
${resume}

Job to evaluate:
Company: ${j.company}
Title: ${j.job_title}
Location: ${j.location}
Description:
${jd}
Source: ${j.source}
Date posted: ${j.date_posted || j.date_found}

Return ONLY valid JSON:
{
  "fit_score": <number>,
  "role_alignment": <number>,
  "skill_overlap": <number>,
  "title_seniority_fit": <number>,
  "visa_safety": <number>,
  "posting_quality": <number>,
  "career_trajectory": <number>,
  "reasoning": "<2-4 sentences>",
  "red_flags": ["<flag1>"],
  "visa_risk": "<low|medium|high>",
  "rejection_reason": <null or string — MUST be non-null if title_seniority_fit is 0 (e.g. "Requires 8+ years experience") or if posting_quality is 0-2 (e.g. "No real job description available")>
}`;

const azure_body = {
  messages: [{ role: 'user', content: user }],
  max_completion_tokens: 1200,
};

return { json: { ...j, azure_body } };
