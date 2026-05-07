// NOTE: S and TERMINAL_STATUSES are injected from _statuses.js by embed-workflows.mjs.
const record = $json && typeof $json === 'object' ? $json : {};
const fields = record.fields || record;
const application_id = fields.application_id || record.application_id;

const status = String(fields.status || '').toUpperCase();
const fit = Number(fields.fit_score) || 0;

const errors = [];
if (status !== S.READY_TO_SUBMIT) errors.push(`status_not_ready:${status}`);
if (fit < 85) errors.push('fit_below_85');
if (!fields.application_url) errors.push('missing_application_url');
if (!fields.resume_link) errors.push('missing_resume_link');

if (TERMINAL_STATUSES.includes(status)) errors.push(`terminal_status:${status}`);

return {
  json: {
    application_id,
    ok: errors.length === 0,
    errors,
    airtable_record_id: record.id,
    fields,
  },
};
