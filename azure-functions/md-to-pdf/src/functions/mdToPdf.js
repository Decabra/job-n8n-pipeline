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

    try {
      const pdf = await markdownToPdf(markdown);
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="tailored_resume.pdf"',
        },
        body: pdf,
      };
    } catch (err) {
      const status = err.status || 500;
      context.log('Conversion failed: ' + (err && err.message ? err.message : String(err)));
      if (status === 400 || status === 413) {
        return {
          status,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: err.message }),
        };
      }
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'PDF conversion failed' }),
      };
    }
  },
});
