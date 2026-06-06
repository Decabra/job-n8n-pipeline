'use strict';

const { chromium } = require('playwright-core');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

const MAX_MARKDOWN_BYTES = 200_000;

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  if (browserInstance) {
    try { await browserInstance.close(); } catch (_) { /* ignore */ }
    browserInstance = null;
  }
  browserInstance = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
  return browserInstance;
}

function wrapResumeHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Resume</title>
  <style>
    @page { size: letter; margin: 0.5in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Calibri, 'Helvetica Neue', Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .resume { max-width: 7.5in; }
    .resume:last-child { margin-bottom: 0; }
    .resume h1 {
      font-size: 16pt;
      font-weight: 600;
      margin: 0 0 4pt 0;
      line-height: 1.15;
    }
    .resume h2 {
      font-size: 11pt;
      font-weight: 600;
      margin: 10pt 0 4pt 0;
      padding-bottom: 2pt;
      border-bottom: 1px solid #333;
      break-after: avoid-page;
      page-break-after: avoid;
    }
    /* Role title + location/date on one row (flex; float breaks in Chromium print PDF) */
    .resume h3 {
      font-size: 10pt;
      font-weight: 600;
      margin: 6pt 0 2pt 0;
      break-after: avoid-page;
      page-break-after: avoid;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      column-gap: 10pt;
    }
    .resume h3 em {
      font-weight: 400;
      font-style: italic;
      font-size: 9pt;
      margin-left: auto;
      text-align: right;
      max-width: 46%;
      flex-shrink: 1;
      line-height: 1.25;
    }
    .resume h3 + ul {
      break-before: avoid;
      page-break-before: avoid;
    }
    .resume p {
      margin: 2pt 0;
      orphans: 2;
      widows: 2;
    }
    .resume ul, .resume ol {
      margin: 2pt 0;
      padding-left: 16pt;
    }
    .resume li { margin-bottom: 1pt; }
    .resume strong { font-weight: 600; }
    /* Visible links (markdown [text](url) and linkify'd URLs) */
    .resume a {
      color: #0b57d0;
      text-decoration: underline;
      text-underline-offset: 1.5pt;
      text-decoration-thickness: 0.5pt;
    }
    .resume a:visited { color: #5b2c91; }
    .resume code {
      font-family: Consolas, 'Courier New', monospace;
      font-size: 9pt;
    }
    /* Markdown --- becomes <hr>; hide so section dividers are only the h2 rule line */
    .resume hr {
      display: none;
      margin: 0;
      border: none;
      height: 0;
    }
  </style>
</head>
<body>
  <div class="resume">${bodyHtml}</div>
</body>
</html>`;
}

/**
 * Cover letter wrapper. Same font family as resume so the two documents look
 * like a matched pair, but uses letter-appropriate spacing: bigger margins,
 * larger font, generous line height, and real paragraph breaks. The H1 is
 * styled to mirror the resume's H1 letterhead, so when the candidate name and
 * contact line are pre-pended to the LLM body the header reads identically
 * to the resume.
 */
function wrapCoverLetterHtml(bodyHtml) {
  // Tightened to guarantee a single-page letter. Margins (0.75in), line-height
  // (1.45), H1 (16pt to mirror resume), HR bottom margin (14pt), and paragraph
  // spacing (10pt) all shaved from the previous "letter generous" defaults
  // because the signature kept overflowing onto page 2 with even mid-length
  // bodies. Combined with the prompt's 150-200 word ceiling, the full letter
  // now sits comfortably on one page with room to spare.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Cover Letter</title>
  <style>
    @page { size: letter; margin: 0.75in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Calibri, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .letter { max-width: 7in; }
    /* Letterhead — mirrors resume H1 styling so the two docs match */
    .letter h1 {
      font-size: 16pt;
      font-weight: 600;
      margin: 0 0 3pt 0;
      line-height: 1.15;
      letter-spacing: 0.2pt;
    }
    /* Optional contact line under the name (rendered when LLM/code emits it as plain paragraph right after H1) */
    .letter h1 + p {
      margin: 0 0 4pt 0;
      font-size: 10pt;
      color: #444;
    }
    /* Divider between letterhead and letter body */
    .letter hr {
      border: none;
      border-top: 1px solid #999;
      margin: 6pt 0 14pt 0;
      height: 0;
    }
    .letter h2 {
      font-size: 12pt;
      font-weight: 600;
      margin: 12pt 0 5pt 0;
    }
    .letter p {
      margin: 0 0 10pt 0;
      orphans: 2;
      widows: 2;
    }
    .letter ul, .letter ol {
      margin: 5pt 0 10pt 0;
      padding-left: 18pt;
    }
    .letter li { margin-bottom: 2pt; }
    .letter strong { font-weight: 600; }
    .letter em { font-style: italic; }
    .letter a {
      color: #0b57d0;
      text-decoration: underline;
      text-underline-offset: 1.5pt;
      text-decoration-thickness: 0.5pt;
    }
    .letter a:visited { color: #5b2c91; }
  </style>
</head>
<body>
  <div class="letter">${bodyHtml}</div>
</body>
</html>`;
}

/**
 * @param {string} markdown
 * @param {string} [type='resume'] — 'resume' (default, dense layout) or 'cover_letter' (letter layout)
 * @returns {Promise<Buffer>}
 */
async function markdownToPdf(markdown, type) {
  const raw = String(markdown || '');
  if (!raw.trim()) {
    const e = new Error('markdown is required');
    e.status = 400;
    throw e;
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_MARKDOWN_BYTES) {
    const e = new Error('markdown too large');
    e.status = 413;
    throw e;
  }

  const bodyHtml = md.render(raw);
  const html = type === 'cover_letter' ? wrapCoverLetterHtml(bodyHtml) : wrapResumeHtml(bodyHtml);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'Letter',
      margin: { top: '0in', right: '0in', bottom: '0in', left: '0in' },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

module.exports = { markdownToPdf, getBrowser };
