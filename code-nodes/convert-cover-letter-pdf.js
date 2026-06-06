const cfg = $('Config').first().json;
const base = $('Build Packet Text').first().json;
const url = String(cfg.pdf_converter_url || '').trim();

if (!url) {
  throw new Error(
    '[Convert Cover Letter PDF] Set pdf_converter_url in workflow 00 Config.',
  );
}

const markdown = String(base.cover_letter_md || '');
if (!markdown.trim()) {
  throw new Error('[Convert Cover Letter PDF] Empty cover_letter_md from Build Packet Text');
}

const body = JSON.stringify({ markdown, type: 'cover_letter' });

function decodeErrBody(data) {
  if (data == null) return '';
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

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
  let extra = err.cause?.message || err.error?.message || err.message || String(err);
  const resp = err.response || err;
  const data = resp?.body ?? resp?.data;
  const status = resp?.statusCode ?? resp?.status ?? err.statusCode;
  const text = decodeErrBody(data);
  if (text) {
    try {
      const j = JSON.parse(text);
      if (j.detail) extra += ` — ${j.detail}`;
      else if (j.error) extra += ` — ${j.error}`;
    } catch {
      if (text.length < 800) extra += ` — ${text}`;
    }
  }
  if (status) extra = `HTTP ${status}: ${extra}`;
  throw new Error(`[Convert Cover Letter PDF] Request failed: ${extra}`);
}

if (!Buffer.isBuffer(pdfBuf)) {
  pdfBuf = Buffer.from(pdfBuf);
}

if (pdfBuf.length < 100 || pdfBuf.slice(0, 5).toString('ascii') !== '%PDF-') {
  const preview = pdfBuf.toString('utf8', 0, 400);
  throw new Error(
    `[Convert Cover Letter PDF] Response is not a PDF (got ${pdfBuf.length} bytes). Preview: ${preview}`,
  );
}

const clFilename = String(cfg.cover_letter_pdf_filename || 'Cover_Letter.pdf');
const binary = await this.helpers.prepareBinaryData(pdfBuf, 'application/pdf', clFilename);
const drive_folder_id = base.folder_name;

return [{ json: { ...base, drive_folder_id, cover_letter_pdf_filename: clFilename }, binary: { data: binary } }];
