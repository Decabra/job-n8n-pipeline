const rec = $('Airtable Load App').first().json;
const folderId = rec.fields?.drive_folder_id || '';
const txt = $('Build Result Text').first().json.result_text || '';

if (!folderId) {
  return [{ json: { skip_upload: true, reason: 'missing_drive_folder_id' } }];
}

const binary = await this.helpers.prepareBinaryData(Buffer.from(txt, 'utf8'), 'text/plain', 'submission_result.txt');

return [{ json: { drive_folder_id: folderId, skip_upload: false }, binary: { data: binary } }];
