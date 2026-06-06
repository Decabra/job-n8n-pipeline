const page = $json;
const input = $('Manual URL Input').first().json || {};

function fnv1aHex(inputStr) {
  const str = String(inputStr || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── HTML→text strip (same approach as JD HTML fetched in Workflow A) ──
function stripHtml(html) {
  let t = String(html || '');
  t = t.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  t = t.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  t = t.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  t = t.replace(/<\/(p|div|li|h[1-6]|tr|dt|dd)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  t = t.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function pluckHtml(resp) {
  if (typeof resp === 'string') return resp;
  if (!resp || typeof resp !== 'object') return '';
  if (typeof resp.data === 'string') return resp.data;
  if (typeof resp.body === 'string') return resp.body;
  if (typeof resp.html === 'string') return resp.html;
  return '';
}

// ── JSON-LD JobPosting extraction (Greenhouse, Lever, Workday, etc.) ──
function extractJsonLd(html) {
  const ldBlocks =
    html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    const inner = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!inner) continue;
    try {
      let parsed = JSON.parse(inner[1].trim());
      if (Array.isArray(parsed)) parsed = parsed.find((o) => o['@type'] === 'JobPosting') || parsed[0];
      if (parsed && parsed['@type'] === 'JobPosting') return parsed;
      if (parsed && parsed['@graph']) {
        const posting = parsed['@graph'].find((o) => o['@type'] === 'JobPosting');
        if (posting) return posting;
      }
    } catch (_) {}
  }
  return null;
}

// ── OG / meta tag extraction ──
function extractMeta(html) {
  const get = (prop) => {
    const m =
      html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')) ||
      html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
    return m ? m[1].trim() : '';
  };
  return {
    ogTitle: get('og:title'),
    ogDesc: get('og:description'),
    ogSiteName: get('og:site_name'),
    metaDesc: get('description'),
    title: (() => {
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    })(),
  };
}

// ── __NEXT_DATA__ extraction (Ashby and other Next.js-based ATSes) ──
// Ashby embeds the full posting in a __NEXT_DATA__ script tag for
// client-side hydration. A plain stripHtml gives us the page shell only
// (header/nav/footer) because the actual JD body is rendered by JS at
// runtime. Walking the parsed JSON for description-shaped string fields
// gets us the real content. Schema varies by tenant
// (props.pageProps.posting.descriptionHtml on Ashby, others use body /
// content / posting.description), so we recursively collect candidates
// and pick the longest one — which is almost always the full JD body
// rather than a meta-description blurb.
function extractNextData(html) {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    const fieldNames = /^(description|descriptionHtml|descriptionPlain|jobDescription|body|content|contentHtml)$/i;
    const candidates = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const v of node) walk(v); return; }
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && fieldNames.test(k) && v.length > 200) {
          candidates.push(v);
        } else if (v && typeof v === 'object') {
          walk(v);
        }
      }
    }
    walk(parsed);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.length - a.length);
    return stripHtml(candidates[0]);
  } catch (_) {
    return null;
  }
}

// ── Targeted content region extraction (job-specific containers → <main> → <article>) ──
function extractMainContent(html) {
  const patterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*(?:class|id)\s*=\s*["'][^"']*(?:job[-_]?desc|job[-_]?detail|job[-_]?content|posting[-_]?detail|description[-_]?body|jd[-_]?content|vacancy[-_]?desc)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<section[^>]*(?:class|id)\s*=\s*["'][^"']*(?:job|posting|description|vacancy|content[-_]?body)[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi,
  ];
  for (const rx of patterns) {
    const matches = [...html.matchAll(rx)];
    if (matches.length > 0) {
      const combined = matches.map((m) => m[1] || m[0]).join('\n');
      const text = stripHtml(combined);
      if (text.length > 200) return text;
    }
  }
  return null;
}

// ── Error detection (empty body, bot walls, non-HTML) ──
const rawUrl = String(input.job_url || '').trim();
if (!rawUrl) {
  throw new Error('[Manual URL] Missing job_url in "Manual URL Input" node.');
}

const hasError = page.error || page.errorMessage || (page.statusCode && page.statusCode >= 400);
if (hasError) {
  const reason = page.error || page.errorMessage || `HTTP ${page.statusCode}`;
  throw new Error(`[Manual URL] Scrape failed for ${rawUrl}: ${reason}`);
}

const html = pluckHtml(page);
if (!html || html.length < 100) {
  throw new Error(
    `[Manual URL] Empty or near-empty response from ${rawUrl} (${(html || '').length} chars). Site may require JS rendering.`,
  );
}

const meta = extractMeta(html);
const jsonLd = extractJsonLd(html);

// ── Build fields: JSON-LD (gold) → OG/meta (silver) → HTML heuristics (bronze) ──
let jobDescription = '';
let jobTitle = '';
let company = '';
let location = '';
let salary = '';
let datePosted = '';

if (jsonLd) {
  jobDescription = typeof jsonLd.description === 'string' ? stripHtml(jsonLd.description) : '';
  jobTitle = String(jsonLd.title || jsonLd.name || '').trim();

  const org = jsonLd.hiringOrganization;
  company = typeof org === 'string' ? org : String((org && org.name) || '').trim();

  const loc = jsonLd.jobLocation;
  if (loc) {
    const addr = loc.address || (Array.isArray(loc) ? (loc[0] && loc[0].address) : null);
    if (addr) {
      location = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
        .filter(Boolean)
        .join(', ');
    }
  }

  if (jsonLd.baseSalary) {
    const val = jsonLd.baseSalary.value;
    if (val) {
      salary =
        val.minValue && val.maxValue
          ? `${val.minValue}-${val.maxValue} ${jsonLd.baseSalary.currency || ''} ${val.unitText || ''}`.trim()
          : String(val.value || val || '');
    }
  }

  datePosted = String(jsonLd.datePosted || '').slice(0, 10);
}

// If JSON-LD description is thin, try __NEXT_DATA__ (Ashby/Next.js sites)
if (jobDescription.length < 200) {
  const nextData = extractNextData(html);
  if (nextData && nextData.length > jobDescription.length) {
    jobDescription = nextData;
  }
}

// Still thin? Try targeted HTML content extraction (server-rendered sites)
if (jobDescription.length < 200) {
  const mainContent = extractMainContent(html);
  if (mainContent && mainContent.length > jobDescription.length) {
    jobDescription = mainContent;
  }
}

// Final fallback: strip entire page (same as Workflow A full-page fallback)
if (jobDescription.length < 200) {
  jobDescription = stripHtml(html);
}

if (jobDescription.length < 50) {
  throw new Error(
    `[Manual URL] Could not extract meaningful JD from ${rawUrl} (${jobDescription.length} chars). Page may be JS-rendered or require auth.`,
  );
}

// ── Fill missing metadata from OG/meta/title tags ──
if (!jobTitle) {
  jobTitle = meta.ogTitle || meta.title || '';
  jobTitle = jobTitle.replace(/\s*[\|–—-]\s*(?:careers?|jobs?|hiring|opportunities)\s*$/i, '').trim();
}
if (!company) {
  company = meta.ogSiteName || '';
}

// Split "Title | Company" or "Title – Company" patterns from <title>
if (jobTitle && !company) {
  const parts = jobTitle
    .split(/\s*[\|–—]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    jobTitle = parts[0];
    company = parts[parts.length - 1];
  }
}
if (jobTitle && !company) {
  const dashParts = jobTitle
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (dashParts.length >= 2) {
    const roleWords = [
      'engineer', 'developer', 'analyst', 'manager', 'scientist', 'architect',
      'lead', 'senior', 'junior', 'remote', 'hybrid', 'intern', 'designer', 'specialist',
    ];
    const last = dashParts[dashParts.length - 1];
    if (!roleWords.some((w) => last.toLowerCase().includes(w)) && last.split(/\s+/).length <= 5) {
      jobTitle = dashParts.slice(0, -1).join(' - ');
      company = last;
    }
  }
}

// Strip company name from title start (SmartRecruiters pattern: "CompanyName Job Title")
if (company.length >= 3 && jobTitle.toLowerCase().startsWith(company.toLowerCase())) {
  jobTitle = jobTitle.slice(company.length).replace(/^\s*[-–—:]\s*/, '').trim() || jobTitle;
}

if (!location) {
  const locMatch =
    jobDescription.match(/(?:location|office|based in|located in)\s*[:.]?\s*([A-Z][a-zA-Z\s,]+(?:,\s*[A-Z]{2})?)/m) ||
    jobDescription.match(/\b(remote|hybrid|on[- ]?site)\b/i);
  if (locMatch) location = (locMatch[1] || locMatch[0]).trim();
}

jobTitle = jobTitle || 'Manual Job';
company = company || 'Unknown';
location = location || 'Unknown';

const now = new Date();
const sourceJobId = `manual_${fnv1aHex(rawUrl)}`;
const applicationId = `APP-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`;

const remoteStatus = /\bremote\b/i.test(location + ' ' + jobTitle)
  ? 'remote'
  : /\bhybrid\b/i.test(location + ' ' + jobTitle)
    ? 'hybrid'
    : 'unknown';

return {
  json: {
    application_id: applicationId,
    source_job_id: sourceJobId,
    company,
    job_title: jobTitle,
    location,
    job_url: rawUrl,
    application_url: rawUrl,
    source: 'manual_url',
    date_found: now.toISOString().slice(0, 10),
    date_posted: datePosted,
    salary,
    remote_status: remoteStatus,
    visa_notes: '',
    job_description: jobDescription.slice(0, 14000),
    _jd_scraped: true,
  },
};
