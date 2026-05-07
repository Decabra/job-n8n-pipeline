const url = String($json.fields?.application_url || '').toLowerCase();
let submission_mode = 'MANUAL_REQUIRED';
let blocker = 'default_manual_mvp';

if (url.includes('myworkdayjobs.com')) {
  submission_mode = 'BLOCKED_BY_WORKDAY';
  blocker = 'workday';
} else if (url.includes('icims.com')) {
  submission_mode = 'BLOCKED_BY_LOGIN';
  blocker = 'icims';
} else if (url.includes('taleo')) {
  submission_mode = 'BLOCKED_BY_COMPLEX_FORM';
  blocker = 'taleo';
} else if (url.includes('greenhouse.io')) {
  submission_mode = 'MANUAL_REQUIRED';
  blocker = 'greenhouse_manual';
} else if (url.includes('lever.co')) {
  submission_mode = 'MANUAL_REQUIRED';
  blocker = 'lever_manual';
} else if (url.includes('ashbyhq.com')) {
  submission_mode = 'MANUAL_REQUIRED';
  blocker = 'ashby_manual';
}

return [{ json: { ...$json, submission_mode, blocker } }];
