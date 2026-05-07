// ┌─────────────────────────────────────────────────────────────────────┐
// │  SINGLE SOURCE OF TRUTH — Pipeline Status Constants               │
// │                                                                   │
// │  This file is auto-prepended to n8n code nodes by                 │
// │  embed-workflows.mjs.  Do NOT duplicate these values elsewhere.   │
// │  To add/remove a status, edit ONLY this file.                     │
// └─────────────────────────────────────────────────────────────────────┘

const S = Object.freeze({
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  READY_TO_SUBMIT:   'READY_TO_SUBMIT',
  MANUAL_REQUIRED:   'MANUAL_REQUIRED',
  NEEDS_FIX:         'NEEDS_FIX',
  REJECTED_BY_USER:  'REJECTED_BY_USER',
  /** Employer / application outcome — set manually when they say no. */
  REJECTED:          'REJECTED',
  APPLIED:           'APPLIED',
  INTERVIEWING:      'INTERVIEWING',
  OFFERED:           'OFFERED',
  CLOSED:            'CLOSED',
});

// All valid status values (for iteration / Airtable singleSelect choices).
const ALL_STATUSES = Object.values(S);

// Statuses where the pipeline must NOT overwrite the record on duplicate ingestion.
const FROZEN_STATUSES = [
  S.READY_TO_SUBMIT, S.MANUAL_REQUIRED,
  S.APPLIED, S.INTERVIEWING, S.OFFERED, S.CLOSED,
  S.REJECTED_BY_USER, S.REJECTED,
];

// Statuses that mean the job lifecycle is terminal — cannot be re-submitted.
const TERMINAL_STATUSES = [
  S.APPLIED, S.INTERVIEWING, S.OFFERED, S.CLOSED,
  S.REJECTED_BY_USER, S.REJECTED,
];
