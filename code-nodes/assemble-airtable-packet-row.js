const cfg = $('Config').first().json;
const account = String(cfg.azure_storage_account || '').trim();
const container = String(cfg.azure_storage_container || '').trim();

function blobPublicUrl(blobPath) {
  if (!account || !container || !blobPath) return '';
  const encodedContainer = encodeURIComponent(container);
  const encodedPath = blobPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `https://${account}.blob.core.windows.net/${encodedContainer}/${encodedPath}`;
}

const base = $('Build Packet Text').item.json;
const folder = base.folder_name || '';
const drive_folder_id = folder;

const resumeFilename = String(cfg.resume_pdf_filename || 'Resume.pdf');
const clFilename = String(cfg.cover_letter_pdf_filename || 'Cover_Letter.pdf');
const resume_link = blobPublicUrl(`${folder}/${resumeFilename}`);
const cover_letter_link = blobPublicUrl(`${folder}/${clFilename}`);
const jd_snapshot_link = blobPublicUrl(`${folder}/original_jd.md`);
const metadata_link = blobPublicUrl(`${folder}/application_metadata.json`);

const note =
  `[${new Date().toISOString().split('T')[0]}] Auto: packet created. ${base.reasoning || ''}`.trim();

return {
  json: {
    ...base,
    drive_folder_id,
    resume_link,
    cover_letter_link,
    jd_snapshot_link,
    metadata_link,
    automation_note: note,
  },
};
