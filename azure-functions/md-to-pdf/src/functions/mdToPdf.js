'use strict';

const { app } = require('@azure/functions');
const { markdownToPdf } = require('../convertToPdf');

app.http('mdToPdf', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'md-to-pdf',
  handler: async (request, context) => {
    context.log('md-to-pdf invoked');

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON body' }),
      };
    }

    const markdown = body && typeof body.markdown === 'string' ? body.markdown : null;
    if (markdown == null) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Body must include string field "markdown"' }),
      };
    }

    const type = body && typeof body.type === 'string' ? body.type : 'resume';
    const dispositionName = type === 'cover_letter' ? 'cover_letter.pdf' : 'tailored_resume.pdf';

    try {
      const pdf = await markdownToPdf(markdown, type);
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${dispositionName}"`,
        },
        body: pdf,
      };
    } catch (err) {
      const status = err.status || 500;
      const msg = err && err.message ? err.message : String(err);
      context.log('Conversion failed: ' + msg);
      if (err && err.stack) context.log(err.stack.slice(0, 2000));
      if (status === 400 || status === 413) {
        return {
          status,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: msg }),
        };
      }
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'PDF conversion failed',
          detail: msg,
        }),
      };
    }
  },
});
