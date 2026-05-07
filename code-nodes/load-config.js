// Called after Execute Workflow returns Config values
// Passes them through so $('Load Config').first().json.xxx works everywhere
const cfg = $input.first().json;
return [{ json: cfg }];
