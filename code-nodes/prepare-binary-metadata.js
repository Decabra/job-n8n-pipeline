const src = $('Build Packet Text').first().json;
const drive_folder_id = src.folder_name;

const buf = Buffer.from(src.metadata_json, 'utf8');
const binary = await this.helpers.prepareBinaryData(buf, 'application/json', 'application_metadata.json');

return [{ json: { ...src, drive_folder_id }, binary: { data: binary } }];
