const cfg = $('Config').first().json;
const base = $('Build Packet Text').first().json;
const url = String(cfg.pdf_converter_url || '').trim();

if (!url) {
  throw new Error(
    '[Convert Resume PDF] Set pdf_converter_url in workflow 00 Config: full Azure Function URL (include ?code=... from portal).',
  );
}

const markdown = String(base.tailored_resume_md || '');
if (!markdown.trim()) {
  throw new Error('[Convert Resume PDF] Empty tailored_resume_md from Build Packet Text');
}

const body = JSON.stringify({ markdown });

let pdfBuf;
try {
  pdfBuf = await this.helpers.httpRequest({
    method: 'POST',
    url,
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/pdf, application/json;q=0.9',
    },
    json: false,
    encoding: 'arraybuffer',
  });
} catch (err) {
  const extra = err.cause?.message || err.error?.message || err.message || String(err);
  throw new Error(`[Convert Resume PDF] Request failed: ${extra}`);
}

if (!Buffer.isBuffer(pdfBuf)) {
  pdfBuf = Buffer.from(pdfBuf);
}

if (pdfBuf.length < 100 || pdfBuf.slice(0, 5).toString('ascii') !== '%PDF-') {
  const preview = pdfBuf.toString('utf8', 0, 400);
  throw new Error(
    `[Convert Resume PDF] Response is not a PDF (got ${pdfBuf.length} bytes). Preview: ${preview}`,
  );
}

const resumeFilename = String(cfg.resume_pdf_filename || 'Resume.pdf');
const binary = await this.helpers.prepareBinaryData(pdfBuf, 'application/pdf', resumeFilename);
const drive_folder_id = base.folder_name;

return [{ json: { ...base, drive_folder_id, resume_pdf_filename: resumeFilename }, binary: { data: binary } }];
