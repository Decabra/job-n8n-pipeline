const originals = $('Normalize Apify Jobs').all();
const scraped = $input.all();
const results = [];

function stripHtml(html) {
  let t = String(html || '');
  t = t.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  t = t.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  t = t.replace(/<\/(p|div|li|h[1-6]|tr|dt|dd)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

for (let i = 0; i < originals.length; i++) {
  const job = { ...originals[i].json };
  const resp = scraped[i]?.json || {};

  const hasError = resp.error || resp.errorMessage || resp.statusCode >= 400;
  if (!hasError) {
    const html = typeof resp === 'string' ? resp
      : (typeof resp.data === 'string' ? resp.data
        : (typeof resp.body === 'string' ? resp.body : ''));
    const text = stripHtml(html);
    if (text.length > 200) {
      job.job_description = text.slice(0, 8000);
      job._jd_scraped = true;
    }
  }
  results.push({ json: job });
}

return results;
