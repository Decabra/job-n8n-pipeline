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
    .resume h3 {
      font-size: 10pt;
      font-weight: 600;
      margin: 6pt 0 2pt 0;
      break-after: avoid-page;
      page-break-after: avoid;
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
 * @param {string} markdown
 * @returns {Promise<Buffer>}
 */
async function markdownToPdf(markdown) {
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
  const html = wrapResumeHtml(bodyHtml);

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
