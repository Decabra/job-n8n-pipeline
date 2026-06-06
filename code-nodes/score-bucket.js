const j = $json && typeof $json === 'object' ? $json : {};
const s = Number(j.fit_score) || 0;
const raw = j.score_raw || {};

const seniorityScore = Number(raw.title_seniority_fit) || 0;
const visaSafety = Number(raw.visa_safety) || 0;
const postingQuality = Number(raw.posting_quality) || 0;
const careerTrajectory = Number(raw.career_trajectory) || 0;
const hasRejection = raw.rejection_reason != null && raw.rejection_reason !== '';

let bucket = s >= 75 ? 'packet' : 'reject';

if (seniorityScore <= 2) bucket = 'reject';
if (visaSafety <= 3) bucket = 'reject';
if (postingQuality <= 2) bucket = 'reject';
if (careerTrajectory <= 2) bucket = 'reject';
if (hasRejection) bucket = 'reject';

return { json: { ...j, bucket } };
