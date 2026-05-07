const src = $('Build Packet Text').first().json;
const drive_folder_id = src.folder_name;

const buf = Buffer.from(src.jdContent, 'utf8');
const binary = await this.helpers.prepareBinaryData(buf, 'text/markdown', 'original_jd.md');

return [{ json: { ...src, drive_folder_id }, binary: { data: binary } }];
