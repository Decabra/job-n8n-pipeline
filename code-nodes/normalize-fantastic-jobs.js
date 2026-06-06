const job = $json && typeof $json === 'object' ? $json : {};

function quickHash12(input) {
  const str = String(input || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').substring(0, 12);
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

function firstArrayValue(v) {
  return Array.isArray(v) && v.length ? v[0] : null;
}

function pickLocation() {
  const derived = firstArrayValue(job.locations_derived);
  if (derived && typeof derived === 'object') {
    const city = String(derived.city || '').trim();
    const admin = String(derived.admin || '').trim();
    const country = String(derived.country || '').trim();
    return [city, admin, country].filter(Boolean).join(', ');
  }
  if (typeof derived === 'string' && derived.trim()) return derived.trim();

  const alt = firstArrayValue(job.locations_alt_raw);
  if (typeof alt === 'string' && alt.trim()) return alt.trim();

  const raw = firstArrayValue(job.locations_raw);
  if (raw && typeof raw === 'object') {
    const addr = raw.address || {};
    const city = String(addr.addressLocality || '').trim();
    const admin = String(addr.addressRegion || '').trim();
    const country = String(addr.addressCountry || '').trim();
    const street = String(raw.value || '').trim();
    return [city, admin, country].filter(Boolean).join(', ') || street;
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim();

  const remoteLocation = firstArrayValue(job.ai_remote_location);
  if (typeof remoteLocation === 'string' && remoteLocation.trim()) return remoteLocation.trim();

  if (job.remote_derived === true || String(job.location_type || '').toUpperCase() === 'TELECOMMUTE') {
    return 'Remote';
  }

  return 'Unknown';
}

function pickRemoteStatus() {
  const ai = String(job.ai_work_arrangement || '').trim().toLowerCase();
  if (ai.includes('remote')) return 'remote';
  if (ai.includes('hybrid')) return 'hybrid';
  if (ai.includes('on-site') || ai.includes('onsite')) return 'onsite';
  if (job.remote_derived === true || String(job.location_type || '').toUpperCase() === 'TELECOMMUTE') {
    return 'remote';
  }
  return 'unknown';
}

function pickSalary() {
  const min = Number(job.ai_salary_minvalue);
  const max = Number(job.ai_salary_maxvalue);
  const single = Number(job.ai_salary_value);
  const unit = String(job.ai_salary_unittext || '').trim();
  const currency = String(job.ai_salary_currency || '').trim();

  const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString() : '');
  if (Number.isFinite(min) || Number.isFinite(max)) {
    const range = [fmt(min), fmt(max)].filter(Boolean).join(' - ');
    return [range, currency, unit].filter(Boolean).join(' ');
  }
  if (Number.isFinite(single)) {
    return [`${fmt(single)}`, currency, unit].filter(Boolean).join(' ');
  }

  const raw = job.salary_raw;
  if (raw && typeof raw === 'object') {
    const base = raw.baseSalary || raw.value || raw;
    const low = Number(base.minValue || base.value?.minValue);
    const high = Number(base.maxValue || base.value?.maxValue);
    const rawCurrency = String(base.currency || base.value?.currency || '').trim();
    const rawUnit = String(base.unitText || base.value?.unitText || '').trim();
    if (Number.isFinite(low) || Number.isFinite(high)) {
      const range = [fmt(low), fmt(high)].filter(Boolean).join(' - ');
      return [range, rawCurrency, rawUnit].filter(Boolean).join(' ');
    }
  }

  return '';
}

const title = firstNonEmpty(job.title, 'Unknown');
const company = firstNonEmpty(job.organization, job.source_domain, 'Unknown');
const jobUrl = firstNonEmpty(job.url);
const sourceJobId = firstNonEmpty(job.id);
const location = pickLocation();
const remoteStatus = pickRemoteStatus();
const salary = pickSalary();
const description = firstNonEmpty(
  job.description_text,
  job.ai_core_responsibilities && job.ai_requirements_summary
    ? `${job.ai_core_responsibilities}\n\n${job.ai_requirements_summary}`
    : '',
);
const jdHash = quickHash12(description || `${title}\n${company}\n${location}`);
const applicationId = `APP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

return {
  json: {
    application_id: applicationId,
    source_job_id: sourceJobId,
    company,
    job_title: title,
    location,
    job_url: jobUrl,
    application_url: jobUrl,
    source: 'apify_fantastic_jobs',
    date_found: new Date().toISOString().split('T')[0],
    date_posted: firstNonEmpty(job.date_posted),
    remote_status: remoteStatus,
    salary,
    job_description: description,
    jd_hash: jdHash,
  },
};
