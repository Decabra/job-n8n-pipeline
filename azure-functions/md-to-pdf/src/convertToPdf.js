'use strict';

const { chromium } = require('playwright-core');
const MarkdownIt = require('markdown-it');
const { injectResumeBlockTables } = require('./resumeBlocks');

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
});

const MAX_MARKDOWN_BYTES = 200_000;
const PAGE_HEIGHT_PX = 11 * 96;
const PAGE_MARGIN_PX = 0.5 * 96;
const RESUME_PAGE_CONTENT_PX = PAGE_HEIGHT_PX - 2 * PAGE_MARGIN_PX;

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
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Calibri, 'Helvetica Neue', Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.35;
      color: #111;
      padding: ${PAGE_MARGIN_PX}px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .resume { max-width: 7.5in; }
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
    }
    .resume h3 {
      font-size: 10pt;
      font-weight: 600;
      margin: 6pt 0 2pt 0;
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
    /* Single-cell table = reliable page-break-inside:avoid in Chromium PDF */
    .resume-block-shell {
      width: 100%;
    }
    table.resume-block {
      width: 100%;
      border-collapse: collapse;
      border: none;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    table.resume-block td {
      border: none;
      padding: 0;
      vertical-align: top;
    }
    .resume p { margin: 2pt 0; orphans: 2; widows: 2; }
    .resume ul, .resume ol { margin: 2pt 0; padding-left: 16pt; }
    .resume li { margin-bottom: 1pt; page-break-inside: avoid; break-inside: avoid-page; }
    .resume strong { font-weight: 600; }
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
    .resume hr { display: none; margin: 0; border: none; height: 0; }
  </style>
</head>
<body>
  <div class="resume">${bodyHtml}</div>
</body>
</html>`;
}

/**
 * If a block's top and bottom land on different pages in print layout, push the
 * whole shell down with margin-top so it starts on the next page.
 */
async function applyResumePageBreaks(page) {
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);

  await page.evaluate(({ contentH }) => {
    const root = document.querySelector('.resume');
    if (!root) return;

    const shells = [...root.querySelectorAll('.resume-block-shell')];
    const rootTop = root.getBoundingClientRect().top;

    function pageIndex(y) {
      return Math.floor((y - rootTop) / contentH);
    }

    function blockStraddles(el) {
      const r = el.getBoundingClientRect();
      if (r.height > contentH) return false;
      const topPage = pageIndex(r.top);
      const bottomPage = pageIndex(r.bottom - 0.5);
      return topPage !== bottomPage;
    }

    function remainingSpace(y) {
      const pos = (y - rootTop) % contentH;
      return pos === 0 ? contentH : contentH - pos;
    }

    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (const shell of shells) {
        shell.style.marginTop = '';
      }

      for (const shell of shells) {
        const r = shell.getBoundingClientRect();
        const h = r.height;
        if (h > contentH) continue;

        const straddles = blockStraddles(shell);
        const space = remainingSpace(r.top);
        const wontFit = space < h - 0.5 && space < contentH;

        if (straddles || wontFit) {
          shell.style.marginTop = `${space}px`;
          moved = true;
          break;
        }
      }

      if (!moved) break;
    }
  }, { contentH: RESUME_PAGE_CONTENT_PX });
}

function wrapCoverLetterHtml(bodyHtml) {
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
    .letter h1 {
      font-size: 16pt;
      font-weight: 600;
      margin: 0 0 3pt 0;
      line-height: 1.15;
      letter-spacing: 0.2pt;
    }
    .letter h1 + p { margin: 0 0 4pt 0; font-size: 10pt; color: #444; }
    .letter hr { border: none; border-top: 1px solid #999; margin: 6pt 0 14pt 0; height: 0; }
    .letter h2 { font-size: 12pt; font-weight: 600; margin: 12pt 0 5pt 0; }
    .letter p { margin: 0 0 10pt 0; orphans: 2; widows: 2; }
    .letter ul, .letter ol { margin: 5pt 0 10pt 0; padding-left: 18pt; }
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
 * @param {string} [type='resume']
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

  const prepared = type === 'cover_letter' ? raw : injectResumeBlockTables(raw);
  const bodyHtml = md.render(prepared);
  const html = type === 'cover_letter' ? wrapCoverLetterHtml(bodyHtml) : wrapResumeHtml(bodyHtml);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    if (type !== 'cover_letter') {
      await applyResumePageBreaks(page);
    }
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

module.exports = {
  markdownToPdf,
  getBrowser,
  injectResumeBlockTables,
  applyResumePageBreaks,
  PAGE_HEIGHT_PX,
  PAGE_MARGIN_PX,
  RESUME_PAGE_CONTENT_PX,
};
