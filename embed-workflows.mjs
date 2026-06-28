/**
 * Generates n8n-importable workflow JSON from code-nodes/*.js
 * Run:  node embed-workflows.mjs
 *
 * Produces 5 workflows:
 *   00 — Shared Config (set your secrets here ONCE)
 *   01 — A: Source → Score → Package  (schedule)
 *   02 — B: Telegram Approval          (telegram trigger)
 *   03 — C: Submission Executor         (sub-workflow called by B)
 *   04 — D: Reporting                   (schedule)
 *
 * A, B, C, D each call workflow 00 at startup via Execute Workflow
 * so you only fill in credentials in ONE place.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, 'code-nodes', f), 'utf8');

function parseDotEnv(src) {
  const out = {};
  for (const rawLine of String(src || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Allow multi-line-ish values in .env via escaped sequences.
    value = value
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');

    out[key] = value;
  }
  return out;
}

const envPath = path.join(__dirname, '.env');
const fileEnv = fs.existsSync(envPath) ? parseDotEnv(fs.readFileSync(envPath, 'utf8')) : {};
const ENV = { ...fileEnv, ...process.env };
const E = (key, fallback = '') => {
  const value = ENV[key];
  return value === undefined || value === null || value === '' ? fallback : String(value);
};

// Shared status constants — prepended to code nodes that reference S.* / FROZEN_STATUSES / etc.
const STATUS_PREAMBLE = read('_statuses.js');
const withS = (src) => STATUS_PREAMBLE + '\n' + src;

const BLOCKED_DOMAINS_PREAMBLE = read('_blocked-job-domains.js');
const withBlocked = (src) => BLOCKED_DOMAINS_PREAMBLE + '\n' + src;
const blockedDomainsCtx = new Function(
  `${BLOCKED_DOMAINS_PREAMBLE}; return { BLOCKED_JOB_DOMAINS, BLOCKED_URL_DOMAIN_NOT, JSEARCH_EXCLUDED_PUBLISHERS };`,
)();
const BLOCKED_JOB_DOMAINS = blockedDomainsCtx.BLOCKED_JOB_DOMAINS;
const BLOCKED_URL_DOMAIN_NOT = blockedDomainsCtx.BLOCKED_URL_DOMAIN_NOT;
const JSEARCH_EXCLUDED_PUBLISHERS = blockedDomainsCtx.JSEARCH_EXCLUDED_PUBLISHERS;

// Mega-employers to strip at the Fantastic source. Source Job Index data showed
// Fantastic surfacing these and crowding out the Series A–C / mid-size / cap-
// exempt roles the candidate actually has a shot at. Precise name exclusion =
// zero yield risk for startups (unlike a blunt LinkedIn employee-count cap).
// Used as Fantastic `organizationExclusionSearch` with ':*' prefix matching.
// Tune freely; not an accusation, just where the candidate doesn't convert.
const MEGACAP_ORG_EXCLUDE = [
  'Google', 'Alphabet', 'Amazon', 'Apple', 'Microsoft', 'Meta', 'Facebook',
  'Netflix', 'Nvidia', 'Oracle', 'Salesforce', 'Adobe', 'IBM', 'Intel', 'Cisco',
  'Uber', 'Lyft', 'Airbnb', 'LinkedIn', 'TikTok', 'ByteDance', 'Walmart',
  'JPMorgan', 'Goldman Sachs', 'Capgemini', 'Deloitte', 'Accenture', 'Cognizant',
  'Infosys', 'Wipro', 'Tata Consultancy', 'UnitedHealth',
];
const MEGACAP_ORG_EXCLUDE_PREFIXED = MEGACAP_ORG_EXCLUDE.map((n) => `${n}:*`);

const SRC = {
  explode:       read('explode-jsearch.js'),
  explodeApify:  read('explode-apify-dataset.js'),
  explodeTheirstack: read('explode-theirstack.js'),
  normalize:     read('normalize-job.js'),
  normFantastic: read('normalize-fantastic-jobs.js'),
  normTheirstack: read('normalize-theirstack.js'),
  normManualUrl: read('normalize-manual-url-job.js'),
  normManualPaste: read('normalize-manual-jd-paste.js'),
  sourceExclusions: read('build-source-exclusions.js'),
  filterFantastic: read('filter-fantastic-exploded.js'),
  filterIncoming: withBlocked(read('filter-and-dedupe-incoming.js')),
  deserializeFetched: read('deserialize-fetched-payloads.js'),
  restoreBucketPayload: read('restore-bucket-payload.js'),
  pullStaleFetched: read('pull-stale-fetched.js'),
  indexFetched: read('index-all-fetched-jobs.js'),
  markIndexProcessed: read('mark-index-processed.js'),

  prepScore:     read('prepare-azure-score-body.js'),
  parseScore:    read('parse-fit-score.js'),
  scoreBucket:   read('score-bucket.js'),
  prepTailor:    read('prepare-azure-tailor-body.js'),
  parseTailor:   read('parse-tailor-response.js'),
  prepCoverLetter:  read('prepare-azure-cover-letter-body.js'),
  parseCoverLetter: read('parse-cover-letter-response.js'),
  convertCoverLetterPdf: read('convert-cover-letter-pdf.js'),
  buildPacket:   read('build-packet-text.js'),
  prepMetaBin:   read('prepare-binary-metadata.js'),
  prepJdBin:     read('prepare-binary-jd.js'),
  convertResumePdf: read('convert-resume-pdf.js'),
  assembleRow:   read('assemble-airtable-packet-row.js'),
  tgPayload:     read('build-telegram-approval-payload.js'),
  wfBRoute:      read('workflow-b-telegram-router.js'),
  wfCValidate:   read('workflow-c-validate.js'),
  wfCClassify:   read('workflow-c-classify-ats.js'),
  wfCResultTxt:  read('build-submission-result-text.js'),
  wfCResultBin:  read('prepare-submission-binary.js'),
  wfDStats:      read('workflow-d-compute-stats.js'),
  ensureSchema:  read('ensure-airtable-schema.js'),
};

// ── helpers ──────────────────────────────────────────────────────────
let _id = 0;
const uid  = () => `n_${++_id}`;
const C    = (f) => `={{ $('Config').first().json.${f} }}`;
const conn = (target) => ({ node: target, type: 'main', index: 0 });
const connIn = (target, inputIndex) => ({ node: target, type: 'main', index: inputIndex });

function N(name, type, ver, pos, params, extra = {}) {
  return { parameters: params, id: uid(), name, type, typeVersion: ver, position: pos, ...extra };
}
function code(name, pos, js, mode = 'runOnceForEachItem', nodeExtra = {}) {
  return N(name, 'n8n-nodes-base.code', 2, pos, { jsCode: js, mode }, nodeExtra);
}
function codeAll(name, pos, js, nodeExtra = {}) {
  return code(name, pos, js, 'runOnceForAllItems', nodeExtra);
}

function wrap(name, nodes, connections) {
  return {
    name, nodes, connections,
    active: false,
    settings: { executionOrder: 'v1' },
    versionId: crypto.randomUUID(),
    meta: { templateCredsSetupCompleted: true },
    tags: [],
  };
}

// Expression helpers
const azureUrl = `={{ $('Config').first().json.azure_openai_resource + '/openai/deployments/' + $('Config').first().json.azure_openai_deployment + '/chat/completions?api-version=' + $('Config').first().json.azure_openai_api_version }}`;
const tgUrl = (m) => `={{ 'https://api.telegram.org/bot' + $('Config').first().json.telegram_bot_token + '/${m}' }}`;

// ── Airtable helper ──
// `nodeExtra` = fields on the node itself (e.g. alwaysOutputData), not inside parameters.
function AT(name, pos, operation, extra = {}, nodeExtra = {}) {
  return N(name, 'n8n-nodes-base.airtable', 2.1, pos, {
    operation,
    base:  { __rl: true, value: C('airtable_base_id'), mode: 'id' },
    table: { __rl: true, value: C('airtable_table_name'), mode: 'name' },
    ...extra,
  }, nodeExtra);
}

// ── Airtable helper for the Source Job Index table ──
// Used by Workflow A to track every TheirStack job_id we've ever fetched
// (regardless of outcome) so the next request's `job_id_not` is comprehensive.
function ATIdx(name, pos, operation, extra = {}, nodeExtra = {}) {
  return N(name, 'n8n-nodes-base.airtable', 2.1, pos, {
    operation,
    base:  { __rl: true, value: C('airtable_base_id'), mode: 'id' },
    table: { __rl: true, value: C('airtable_source_index_table_name'), mode: 'name' },
    ...extra,
  }, nodeExtra);
}

// ── Azure Blob upload (Shared Key credential on each node after import) ──
function ABU(name, pos, blobCreateExpr) {
  return N(name, 'n8n-nodes-base.azureStorage', 1, pos, {
    authentication: 'sharedKey',
    resource: 'blob',
    operation: 'create',
    container: { __rl: true, mode: 'id', value: C('azure_storage_container') },
    blobCreate: blobCreateExpr,
    from: 'binary',
    binaryPropertyName: 'data',
  });
}

// ── "Load Config" block (2 nodes + 2 connections) ──
// Each workflow calls Workflow 00, which returns all config fields.
// The result is a node named "Config" so $('Config').first().json.xxx works everywhere.
function configLoader(pos) {
  const execNode = N('Fetch Config', 'n8n-nodes-base.executeWorkflow', 1.2, pos, {
    source: 'database',
    workflowId: { __rl: true, mode: 'id', value: 'SET_CONFIG_WORKFLOW_ID_HERE' },
    mode: 'each',
    options: { waitForSubWorkflow: true },
  });
  const aliasNode = N('Config', 'n8n-nodes-base.set', 3.4, [pos[0] + 220, pos[1]], {
    mode: 'manual',
    duplicateItem: false,
    assignments: { assignments: [] },
    includeOtherFields: true,
    options: {},
  });
  return { nodes: [execNode, aliasNode], connKey: 'Fetch Config', aliasKey: 'Config' };
}

// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW 00 — Shared Config (set values HERE once)
// ═══════════════════════════════════════════════════════════════════════
function build00() {
  const nodes = [
    // Required for parent "Execute Workflow" calls: default mode expects a schema; empty schema = error.
    // "passthrough" = Accept all data (see n8n Execute Sub-workflow Trigger docs).
    N('When Called By Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 200], {
      inputSource: 'passthrough',
    }),
    N('Config', 'n8n-nodes-base.set', 3.4, [220, 200], {
      assignments: { assignments: [
        { id: 'c0',  name: 'airtable_base_id',        value: E('AIRTABLE_BASE_ID', 'YOUR_AIRTABLE_BASE_ID'),    type: 'string' },
        { id: 'c0b', name: 'airtable_table_name',     value: E('AIRTABLE_TABLE_NAME', 'Jobs Application Tracker'),  type: 'string' },
        { id: 'c0e', name: 'airtable_source_index_table_name', value: E('AIRTABLE_SOURCE_INDEX_TABLE_NAME', 'Source Job Index'), type: 'string' },
        // How far back to read the Source Job Index for prefetch exclusions.
        // 30 days is well past the freshness window of any job source we use
        // (all configured to ≤1 day), so anything older can never reappear.
        // Keeping this windowed prevents the prefetch read from ballooning
        // as the index grows over months.
        { id: 'c0f', name: 'source_index_lookback_days', value: E('SOURCE_INDEX_LOOKBACK_DAYS', '30'), type: 'string' },
        { id: 'c0c', name: 'airtable_pat',            value: E('AIRTABLE_PAT', 'YOUR_AIRTABLE_PAT'),         type: 'string' },
        { id: 'c0d', name: 'airtable_schema_cache_ttl_seconds', value: E('AIRTABLE_SCHEMA_CACHE_TTL_SECONDS', '86400'), type: 'string' },
        { id: 'c1',  name: 'telegram_bot_token',      value: E('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN'),  type: 'string' },
        { id: 'c2',  name: 'telegram_chat_id',        value: E('TELEGRAM_CHAT_ID', 'YOUR_TELEGRAM_CHAT_ID'),    type: 'string' },
        { id: 'c3a', name: 'azure_storage_account',   value: E('AZURE_STORAGE_ACCOUNT', 'YOUR_STORAGE_ACCOUNT_NAME'), type: 'string' },
        { id: 'c3b', name: 'azure_storage_container', value: E('AZURE_STORAGE_CONTAINER', 'job-applications'),         type: 'string' },
        { id: 'c4',  name: 'azure_openai_resource',   value: E('AZURE_OPENAI_RESOURCE', 'YOUR_AZURE_ENDPOINT_URL'),  type: 'string' },
        { id: 'c5',  name: 'azure_openai_deployment', value: E('AZURE_OPENAI_DEPLOYMENT', 'YOUR_DEPLOYMENT_NAME'),     type: 'string' },
        { id: 'c5b', name: 'azure_openai_api_version', value: E('AZURE_OPENAI_API_VERSION', 'YOUR_AZURE_OPENAI_API_VERSION'), type: 'string' },
        { id: 'c6',  name: 'azure_openai_api_key',    value: E('AZURE_OPENAI_API_KEY', 'YOUR_AZURE_API_KEY'),       type: 'string' },
        { id: 'c7',  name: 'rapidapi_key',            value: E('RAPIDAPI_KEY', 'YOUR_RAPIDAPI_KEY'),        type: 'string' },
        { id: 'c7j', name: 'job_search_queries',      value: E('JOB_SEARCH_QUERIES', 'YOUR_SEARCH_QUERIES'), type: 'string' },
        { id: 'c7a', name: 'apify_token',             value: E('APIFY_TOKEN', 'YOUR_APIFY_TOKEN'),         type: 'string' },
        { id: 'c7v', name: 'theirstack_api_key',      value: E('THEIRSTACK_API_KEY', 'YOUR_THEIRSTACK_API_KEY'),  type: 'string' },
        // TheirStack is our precision startup/funding-aware source. It was
        // starved (limit 10 + 1-day window + 500-emp cap) and returned ~nothing.
        // Raise volume + widen the window; cost is per returned job so tune to taste.
        { id: 'c7w', name: 'theirstack_limit',        value: E('THEIRSTACK_LIMIT', '25'),                     type: 'string' },
        { id: 'c7y', name: 'theirstack_max_age_days', value: E('THEIRSTACK_MAX_AGE_DAYS', '7'),               type: 'string' },
        // Mid-size ceiling for the firmographic sources. Series A–C + mid-size
        // typically sit well under this; raising past ~2000 starts pulling
        // big-tech back in. TheirStack uses native firmographics (safe).
        { id: 'c7z', name: 'theirstack_max_employees', value: E('THEIRSTACK_MAX_EMPLOYEES', '2000'),          type: 'string' },
        { id: 'c7x', name: 'fantastic_jobs_limit',    value: E('FANTASTIC_JOBS_LIMIT', '50'),                     type: 'string' },
        // Fantastic LinkedIn-based size cap. OFF by default ('' or 0): the LI
        // employee-count filter drops jobs whose company LinkedIn match has no
        // employee data — that can silently kill real startups. Megacaps are
        // already stripped by name (MEGACAP_ORG_EXCLUDE). Set a number (e.g.
        // 2000) only if big names still leak through, and watch yield.
        { id: 'c7f', name: 'fantastic_max_employees', value: E('FANTASTIC_MAX_EMPLOYEES', ''),                type: 'string' },
        { id: 'c8',  name: 'base_resume_text',        value: E('BASE_RESUME_TEXT', 'PASTE_YOUR_FULL_RESUME_HERE'), type: 'string' },
        { id: 'c8a', name: 'candidate_name',          value: E('CANDIDATE_NAME', 'YOUR_NAME'),                 type: 'string' },
        { id: 'c8b', name: 'candidate_contact_line',  value: E('CANDIDATE_CONTACT_LINE', 'email · phone · LinkedIn URL'), type: 'string' },
        { id: 'c9',  name: 'submission_workflow_id',   value: E('SUBMISSION_WORKFLOW_ID', 'YOUR_WORKFLOW_C_ID'),       type: 'string' },
        { id: 'c9s', name: 'scoring_workflow_id',      value: E('SCORING_WORKFLOW_ID', 'YOUR_WORKFLOW_02_SCORING_ID'), type: 'string' },
        { id: 'c9p', name: 'pdf_converter_url',        value: E('PDF_CONVERTER_URL', 'YOUR_AZURE_MD_TO_PDF_URL_WITH_CODE'), type: 'string' },
        { id: 'c9r', name: 'resume_pdf_filename',       value: E('RESUME_PDF_FILENAME', 'tailored_resume.pdf'),    type: 'string' },
        { id: 'c9c', name: 'cover_letter_pdf_filename', value: E('COVER_LETTER_PDF_FILENAME', 'Cover_Letter.pdf'),       type: 'string' },
      ]},
      options: {},
    }),
    codeAll('Ensure Airtable Schema', [440, 200], withS(SRC.ensureSchema)),
  ];
  const conns = {
    'When Called By Another Workflow': { main: [[ conn('Config') ]] },
    'Config': { main: [[ conn('Ensure Airtable Schema') ]] },
  };
  return wrap('Job Pipeline 00 — Shared Config', nodes, conns);
}


// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW 01 — Job Sourcing (fetch → merge → dedupe → Source Job Index)
// ═══════════════════════════════════════════════════════════════════════
// Ends at Index All Fetched Jobs (FETCHED + payload_json in Source Job Index).
// Workflow 02 runs independently and reads those rows. STATUS STRINGS in
// Workflow 02 nodes MUST match code-nodes/_statuses.js.
// ═══════════════════════════════════════════════════════════════════════
function buildSourcing() {
  // ── Layout grid (keep n8n canvas tidy on import) ──────────────────────
  // Same grid as the old monolithic A (sources + merge + filter + index).
  // Horizontal stride 220px; vertical lanes keep multi-source branches readable.
  //
  // Vertical lanes (top → bottom):
  //   LANE_TOP   100  JSearch source row
  //   LANE_CFG   200  Fetch Config + Config (col 1–2 only)
  //   IF_TOP     240  JSearch + Fantastic merge anchor column
  //   LANE_TRIG  300  Manual Test trigger (col 0 only)
  //   LANE_MAIN  380  Fantastic row + merge / filter / index (terminal)
  //   FANT_TOP   460  Fantastic.jobs "has dataset" branch
  //   IF_BOT     520  Apify "no dataset" skip branch + Fantastic main row
  //   FANT_BOT   580  Fantastic.jobs "no dataset" skip branch
  //   LANE_BOT   660  TheirStack source + Source-Index prefetch row
  //   LANE_STALE 800  Pull Stale FETCHED retry branch (4th source)
  //
  // Horizontal columns: 220 px stride from x=0. Each column owns one
  // "step" of the chain so vertical alignment across lanes is automatic.
  const COL = (i) => i * 220;
  const Y = {
    TOP: 100, CFG: 200, IF_TOP: 240, TRIG: 300,
    MAIN: 380, FANT_TOP: 460, IF_BOT: 520, FANT_BOT: 580, BOT: 660, STALE: 800, WRAP: 880,
  };

  const cfg = configLoader([COL(1), Y.CFG]);

  const nodes = [
    N('Manual Test', 'n8n-nodes-base.manualTrigger', 1, [COL(0), Y.TRIG], {}),
    N('Twice daily ET', 'n8n-nodes-base.scheduleTrigger', 1.2, [COL(0), Y.TOP], {
      rule: {
        interval: [{ field: 'cronExpression', expression: '0 13,19 * * *' }],
      },
      timezone: 'America/New_York',
    }, { notes: 'Runs 13:00 and 19:00 US Eastern (10:00 and 16:00 Pacific).', notesInFlow: true }),
    ...cfg.nodes,

    N('JSearch API', 'n8n-nodes-base.httpRequest', 4.2, [COL(3), Y.TOP], {
      method: 'GET',
      url: 'https://jsearch.p.rapidapi.com/search',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'query', value: "={{ $('Config').first().json.job_search_queries }}" },
        { name: 'page', value: '1' },
        { name: 'num_pages', value: '3' },
        { name: 'date_posted', value: 'today' },
        { name: 'exclude_job_publishers', value: JSEARCH_EXCLUDED_PUBLISHERS.join(',') },
      ]},
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'X-RapidAPI-Host', value: 'jsearch.p.rapidapi.com' },
        { name: 'X-RapidAPI-Key', value: C('rapidapi_key') },
      ]},
      options: { timeout: 120000 },
    }),

    // Fantastic.jobs' indexed career-site API: `date_posted` plus plain-text
    // descriptions suitable for scoring without an extra JD scrape hop.
    N('Fantastic Jobs API', 'n8n-nodes-base.httpRequest', 4.2, [COL(3), Y.IF_BOT], {
      method: 'POST',
      url: `={{ 'https://api.apify.com/v2/acts/fantastic-jobs~career-site-job-listing-api/runs?waitForFinish=180&token=' + encodeURIComponent($('Config').first().json.apify_token || '') }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ timeRange: '24h', limit: Math.max(10, Number($('Config').first().json.fantastic_jobs_limit || 50)), includeAi: true, descriptionType: 'text', removeAgency: true, domainExclusionFilter: ${JSON.stringify(BLOCKED_JOB_DOMAINS)}, organizationExclusionSearch: ${JSON.stringify(['beBee:*', 'recruit.net', 'JobLeads:*', ...MEGACAP_ORG_EXCLUDE_PREFIXED])}, titleSearch: ['AI engineer', 'ML engineer', 'LLM engineer', 'machine learning engineer', 'applied AI', 'agent engineer', 'gen AI', 'AI platform', 'data engineer', 'software engineer', 'backend engineer'], titleExclusionSearch: ['staff', 'principal', 'director', 'VP', 'head of', 'lead', 'distinguished', 'intern', 'co op'], descriptionExclusionSearch: ['security clearance', 'TS/SCI', 'polygraph', 'Public Trust', 'US citizens only', 'must be a US citizen', 'citizenship required', 'no visa sponsorship', 'without sponsorship', 'without current or future sponsorship'], aiExperienceLevelFilter: ['0-2', '2-5'], locationSearch: ['United States'], ...(Number($('Config').first().json.fantastic_max_employees || 0) > 0 ? { includeLinkedIn: true, liOrganizationEmployeesLte: Number($('Config').first().json.fantastic_max_employees) } : {}), idExclusionFilter: $('Build Source Exclusions').first().json.fantastic_job_id_not || [] }) }}`,
      options: { timeout: 300000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    N('IF Fantastic Dataset', 'n8n-nodes-base.if', 2.2, [COL(4), Y.IF_BOT], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'fd', leftValue: '={{ $json.data.defaultDatasetId }}', rightValue: '',
          operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and' },
    }),
    N('Fantastic Fetch Dataset', 'n8n-nodes-base.httpRequest', 4.2, [COL(5), Y.FANT_TOP], {
      method: 'GET',
      url: `={{ 'https://api.apify.com/v2/datasets/' + $json.data.defaultDatasetId + '/items?clean=true&token=' + encodeURIComponent($('Config').first().json.apify_token || '') }}`,
      options: { timeout: 120000 },
    }),
    codeAll('Fantastic Skip No Dataset', [COL(5), Y.FANT_BOT], 'return [{ json: { _apify_skip: true } }];'),
    codeAll('Explode Fantastic Dataset', [COL(6), Y.IF_BOT], SRC.explodeApify, { alwaysOutputData: true }),
    codeAll('Filter Fantastic Prefilter', [COL(6.5), Y.IF_BOT], SRC.filterFantastic, { alwaysOutputData: true }),
    code('Normalize Fantastic Jobs', [COL(7), Y.IF_BOT], SRC.normFantastic, 'runOnceForEachItem', { alwaysOutputData: true }),

    codeAll('Seed Source Exclusions Prefetch', [COL(3), Y.BOT], 'return [{ json: { prefetch_source_ids: true } }];'),
    // Source Job Index — comprehensive superset of every job_id we've ever
    // fetched from any source (jsearch, apify, theirstack, future ones).
    // Filtered to the configured lookback window so this read stays cheap
    // even after months of accumulation; older entries can't reappear anyway
    // because every source API filters to ≤1 day of postings.
    ATIdx(
      'Airtable List Source Job Index',
      [COL(4), Y.BOT],
      'search',
      {
        returnAll: true,
        filterByFormula: `={{ "IS_AFTER({date_fetched}, DATEADD(TODAY(), -" + Math.max(1, Number($('Config').first().json.source_index_lookback_days || '30')) + ", 'days'))" }}`,
        options: {},
      },
      { alwaysOutputData: true },
    ),
    codeAll('Build Source Exclusions', [COL(5), Y.BOT], SRC.sourceExclusions, { alwaysOutputData: true }),

    N('TheirStack Jobs API', 'n8n-nodes-base.httpRequest', 4.2, [COL(6), Y.BOT], {
      method: 'POST',
      url: 'https://api.theirstack.com/v1/jobs/search',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Accept', value: 'application/json' },
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: `={{ 'Bearer ' + $('Config').first().json.theirstack_api_key }}` },
      ]},
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ page: 0, limit: Number($('Config').first().json.theirstack_limit || 10), posted_at_max_age_days: Math.max(1, Number($('Config').first().json.theirstack_max_age_days || 7)), job_country_code_or: ['US'], job_seniority_or: ['junior', 'mid_level'], company_type: 'direct_employer', max_employee_count: Math.max(1, Number($('Config').first().json.theirstack_max_employees || 2000)), funding_stage_or: ['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'early_vc', 'angel', 'venture_round_not_specified'], job_title_pattern_or: ['AI.engineer', 'ML.engineer', 'LLM.engineer', 'machine.learning.engineer', 'applied.AI', 'agent.engineer', 'gen.AI', 'AI.platform', 'data.engineer', 'software.engineer', 'backend.engineer'], job_title_pattern_not: ['staff', 'principal', 'director', 'VP', 'head.of', 'lead', 'distinguished', 'intern', 'co.op'], job_description_pattern_or: ['LLM', 'RAG', 'agentic', 'AI.agent', 'embedding', 'GPT', 'langchain', 'vector', 'FastAPI', 'Python', 'TypeScript', 'microservice', 'distributed.systems', 'ETL', 'data.pipeline', 'dbt', 'Airflow', 'Postgres', 'Azure'], job_description_pattern_not: ['security.clearance', 'TS/SCI', 'polygraph', 'Public.Trust', 'US.citizens.only', 'must.be.a.US.citizen', 'citizenship.required', 'no.visa.sponsorship', 'without.sponsorship', 'without.current.or.future.sponsorship'], job_description_pattern_is_case_insensitive: true, employment_statuses_or: ['full_time'], url_domain_not: ${JSON.stringify(BLOCKED_URL_DOMAIN_NOT)}, job_id_not: $('Build Source Exclusions').first().json.theirstack_job_id_not || [], include_total_results: false, order_by: [{ desc: true, field: 'date_posted' }, { desc: true, field: 'discovered_at' }] }) }}`,
      options: { timeout: 30000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    codeAll('Explode TheirStack', [COL(7), Y.BOT], SRC.explodeTheirstack, { alwaysOutputData: true }),
    code('Normalize TheirStack Jobs', [COL(8), Y.BOT], SRC.normTheirstack, 'runOnceForEachItem', { alwaysOutputData: true }),

    N('Merge JSearch Fantastic', 'n8n-nodes-base.merge', 3, [COL(10), Y.IF_TOP], { mode: 'append', numberInputs: 2, options: {} }),
    N('Merge All Job Sources', 'n8n-nodes-base.merge', 3, [COL(11), Y.MAIN], { mode: 'append', numberInputs: 3, options: {} }),
    // Three streams into Merge All: 0 = JSearch + Fantastic.jobs (via Merge
    // JSearch Fantastic), 1 = TheirStack, 2 = stale FETCHED retries from the
    // Source Job Index. Append preserves order so fresh items beat stale
    // duplicates when Filter & Dedupe keeps first occurrence.
    // Stale-FETCHED retry branch — proactively replays jobs whose
    // scoring loop crashed in a prior run, instead of hoping the source
    // APIs return them again (they usually don't, ≤1 day freshness).
    // Reads the same Airtable List snapshot as Build Source Exclusions,
    // deserializes payload_json from each FETCHED row, stamps a
    // _retry_from_index flag, and merges into Merge All Job Sources as
    // input 2. See code-nodes/pull-stale-fetched.js for full reasoning.
    codeAll('Pull Stale FETCHED', [COL(10), Y.STALE], SRC.pullStaleFetched, { alwaysOutputData: true }),
    // One node, one iteration, three drops: stale (>24h), excluded (in
    // index snapshot), duplicate (within current batch by `${source}::${source_job_id}`).
    // Replaces the previous Filter Stale + Apply Source Exclusions + Dedupe
    // Incoming chain. Stats stamped on the first surviving item as
    // `_filter_stats` for n8n run-inspector visibility.
    codeAll('Filter & Dedupe Incoming', [COL(12), Y.MAIN], SRC.filterIncoming, { alwaysOutputData: true }),

    // Index All Fetched Jobs — terminal node for 01. Writes FETCHED rows with
    // payload_json; Workflow 02 reads them independently. Custom code PATCHes
    // Airtable in chunks with retry/backoff.
    codeAll('Index All Fetched Jobs', [COL(13), Y.MAIN], SRC.indexFetched, { alwaysOutputData: true }),

    codeAll('Explode JSearch', [COL(4), Y.TOP], SRC.explode),
    codeAll('Normalize Jobs', [COL(5), Y.TOP], SRC.normalize),
  ];

  const X = {
    'Manual Test':               { main: [[ conn('Fetch Config') ]] },
    'Twice daily ET':            { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':              { main: [[ conn('Config') ]] },
    'Config':                    { main: [[ conn('JSearch API'), conn('Seed Source Exclusions Prefetch') ]] },
    'Seed Source Exclusions Prefetch': { main: [[ conn('Airtable List Source Job Index') ]] },
    // Index snapshot fans out to TWO consumers (single Airtable read,
    // two uses): Build Source Exclusions extracts PROCESSED ids for the
    // exclusion lists, Pull Stale FETCHED extracts FETCHED rows whose
    // payload_json gets replayed as a 4th source into Merge All.
    'Airtable List Source Job Index': { main: [[ conn('Build Source Exclusions'), conn('Pull Stale FETCHED') ]] },
    'Build Source Exclusions': { main: [[ conn('TheirStack Jobs API'), conn('Fantastic Jobs API') ]] },
    'Pull Stale FETCHED': { main: [[ connIn('Merge All Job Sources', 2) ]] },
    'JSearch API':               { main: [[ conn('Explode JSearch') ]] },
    'Explode JSearch':           { main: [[ conn('Normalize Jobs') ]] },
    'Normalize Jobs':            { main: [[ connIn('Merge JSearch Fantastic', 0) ]] },
    'Fantastic Jobs API':        { main: [[ conn('IF Fantastic Dataset') ]] },
    'IF Fantastic Dataset':      { main: [[ conn('Fantastic Fetch Dataset') ], [ conn('Fantastic Skip No Dataset') ]] },
    'Fantastic Fetch Dataset':   { main: [[ conn('Explode Fantastic Dataset') ]] },
    'Fantastic Skip No Dataset': { main: [[ conn('Explode Fantastic Dataset') ]] },
    'Explode Fantastic Dataset': { main: [[ conn('Filter Fantastic Prefilter') ]] },
    'Filter Fantastic Prefilter': { main: [[ conn('Normalize Fantastic Jobs') ]] },
    'Normalize Fantastic Jobs':  { main: [[ connIn('Merge JSearch Fantastic', 1) ]] },
    'Merge JSearch Fantastic': { main: [[ connIn('Merge All Job Sources', 0) ]] },
    'TheirStack Jobs API':       { main: [[ conn('Explode TheirStack') ]] },
    'Explode TheirStack':        { main: [[ conn('Normalize TheirStack Jobs') ]] },
    'Normalize TheirStack Jobs': { main: [[ connIn('Merge All Job Sources', 1) ]] },
    'Merge All Job Sources':     { main: [[ conn('Filter & Dedupe Incoming') ]] },
    'Filter & Dedupe Incoming':  { main: [[ conn('Index All Fetched Jobs') ]] },
  };

  return wrap('Job Pipeline 01 — Job Sourcing', nodes, X);
}

// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW 02 — Score & Package (Split Jobs → Telegram)
// ═══════════════════════════════════════════════════════════════════════
// Independent of 01: Fetch Config → 00, list FETCHED rows from Source Job
// Index, deserialize payload_json, then existing scoring loop.
// If no FETCHED rows exist, Airtable returns 0 items → Deserialize and
// Split Jobs never run (no Azure). Never enable alwaysOutputData on the
// Airtable list node.
// STATUS STRINGS MUST match code-nodes/_statuses.js.
// ═══════════════════════════════════════════════════════════════════════
function buildScoring() {
  const SC = (k) => (k - 12) * 220;
  const Y = {
    TOP: 100, CFG: 200, IF_TOP: 240, TRIG: 300,
    MAIN: 380, FANT_TOP: 460, IF_BOT: 520, FANT_BOT: 580, BOT: 660, STALE: 800, WRAP: 880,
  };

  const cfg = configLoader([220, Y.CFG]);

  const nodes = [
    N('Manual Test', 'n8n-nodes-base.manualTrigger', 1, [0, Y.TRIG], {}),
    N('Every 30 minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, Y.TOP], {
      rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] },
    }, { disabled: true, notes: 'Enable when ready for automatic scoring runs.', notesInFlow: true }),
    ...cfg.nodes,
    ATIdx(
      'Airtable List FETCHED',
      [660, Y.CFG],
      'search',
      {
        returnAll: true,
        filterByFormula: '={outcome}="FETCHED"',
        options: {},
      },
    ),
    codeAll('Deserialize FETCHED Payloads', [770, Y.CFG], SRC.deserializeFetched),
    // Main-table prefetch dedup is gone: every job that ever became a packet
    // was first fetched, and every fetched job is in the Source Job Index.
    // So if `Filter & Dedupe Incoming` already dropped a job against the
    // index, it can't possibly be in the main table either. The Airtable
    // Create Packet upsert (matched on source + source_job_id) handles the
    // residual race-condition case where two concurrent runs reach Create at once.
    N('Split Jobs', 'n8n-nodes-base.splitInBatches', 3, [SC(15), Y.MAIN], { batchSize: 1, options: {} }),

    code('Prepare Azure Score Body', [SC(16), Y.MAIN], SRC.prepScore),
    N('Azure Fit Score', 'n8n-nodes-base.httpRequest', 4.2, [SC(17), Y.MAIN], {
      method: 'POST', url: azureUrl,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'api-key', value: C('azure_openai_api_key') },
        { name: 'Content-Type', value: 'application/json' },
      ]},
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.azure_body) }}',
      options: { timeout: 120000 },
    }),
    code('Parse Fit Score', [SC(18), Y.MAIN], SRC.parseScore),
    code('Score Bucket', [SC(19), Y.MAIN], SRC.scoreBucket),

    code('Mark As Processed', [SC(20), Y.MAIN], SRC.markIndexProcessed, 'runOnceForEachItem', {
      alwaysOutputData: true,
    }),
    codeAll('Restore Bucket Payload', [SC(21), Y.MAIN], SRC.restoreBucketPayload, { alwaysOutputData: true }),

    N('Switch Bucket', 'n8n-nodes-base.switch', 3.2, [SC(22), Y.MAIN], {
      rules: { values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'r1', leftValue: '={{ $json.bucket }}', rightValue: 'packet',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'packet' },
      ]},
      options: { fallbackOutput: 'extra' },
    }),

    code('Prepare Azure Tailor Body', [SC(23), Y.MAIN], SRC.prepTailor),
    N('Azure Tailor Resume', 'n8n-nodes-base.httpRequest', 4.2, [SC(24), Y.MAIN], {
      method: 'POST', url: azureUrl,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'api-key', value: C('azure_openai_api_key') },
        { name: 'Content-Type', value: 'application/json' },
      ]},
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.azure_body) }}',
      options: { timeout: 180000 },
    }),
    code('Parse Tailor Response', [SC(25), Y.MAIN], SRC.parseTailor),

    code('Prepare Azure Cover Letter Body', [SC(26), Y.MAIN], SRC.prepCoverLetter),
    N('Azure Cover Letter', 'n8n-nodes-base.httpRequest', 4.2, [SC(27), Y.MAIN], {
      method: 'POST', url: azureUrl,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'api-key', value: C('azure_openai_api_key') },
        { name: 'Content-Type', value: 'application/json' },
      ]},
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.azure_body) }}',
      options: { timeout: 120000 },
    }),
    code('Parse Cover Letter Response', [SC(28), Y.MAIN], SRC.parseCoverLetter),

    code('Build Packet Text', [SC(29), Y.MAIN], SRC.buildPacket),

    codeAll('Prep Binary Metadata', [SC(29), Y.WRAP], SRC.prepMetaBin),
    ABU('Upload Metadata', [SC(28), Y.WRAP], '={{ $json.folder_name + \'/application_metadata.json\' }}'),
    codeAll('Prep Binary JD', [SC(27), Y.WRAP], SRC.prepJdBin),
    ABU('Upload JD', [SC(26), Y.WRAP], '={{ $json.folder_name + \'/original_jd.md\' }}'),
    codeAll('Convert Resume PDF', [SC(25), Y.WRAP], SRC.convertResumePdf),
    ABU('Upload Resume', [SC(24), Y.WRAP], '={{ $json.folder_name + \'/\' + $json.resume_pdf_filename }}'),
    codeAll('Convert Cover Letter PDF', [SC(23), Y.WRAP], SRC.convertCoverLetterPdf),
    ABU('Upload Cover Letter', [SC(22), Y.WRAP], '={{ $json.folder_name + \'/\' + $json.cover_letter_pdf_filename }}'),

    code('Assemble Airtable Row', [SC(21), Y.WRAP], SRC.assembleRow),

    AT('Airtable Create Packet', [SC(20), Y.WRAP], 'upsert', {
      columns: { mappingMode: 'defineBelow', value: {
        application_id: '={{ $json.application_id }}',
        source_job_id: '={{ $json.source_job_id }}',
        company: '={{ $json.company }}',
        job_title: '={{ $json.job_title }}', location: '={{ $json.location }}',
        job_url: '={{ $json.job_url }}', application_url: '={{ $json.application_url }}',
        source: '={{ $json.source }}', date_found: '={{ $json.date_found }}',
        status: 'AWAITING_APPROVAL', fit_score: '={{ $json.fit_score }}',
        resume_link: '={{ $json.resume_link }}', jd_snapshot_link: '={{ $json.jd_snapshot_link }}',
        cover_letter_link: '={{ $json.cover_letter_link }}', submission_mode: 'MANUAL_REQUIRED',
        notes: '={{ $json.automation_note }}', next_action: 'Review Telegram approval',
        salary: '={{ $json.salary }}', remote_status: '={{ $json.remote_status }}',
        visa_notes: '={{ $json.visa_notes }}',
        drive_folder_id: '={{ $json.drive_folder_id }}',
      }, matchingColumns: ['source_job_id', 'source'], schema: [] }, options: {},
    }),

    code('Build Telegram Approval', [SC(19), Y.WRAP], SRC.tgPayload),

    N('Telegram Send Preview', 'n8n-nodes-base.httpRequest', 4.2, [SC(18), Y.WRAP], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.telegram_http_body) }}',
      options: {},
    }),
  ];

  const X = {
    'Manual Test':               { main: [[ conn('Fetch Config') ]] },
    'Every 30 minutes':          { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':              { main: [[ conn('Config') ]] },
    'Config':                    { main: [[ conn('Airtable List FETCHED') ]] },
    'Airtable List FETCHED':     { main: [[ conn('Deserialize FETCHED Payloads') ]] },
    'Deserialize FETCHED Payloads': { main: [[ conn('Split Jobs') ]] },
    'Split Jobs':                { main: [[], [conn('Prepare Azure Score Body')]] },
    'Prepare Azure Score Body':  { main: [[ conn('Azure Fit Score') ]] },
    'Azure Fit Score':           { main: [[ conn('Parse Fit Score') ]] },
    'Parse Fit Score':           { main: [[ conn('Score Bucket') ]] },
    'Score Bucket':              { main: [[ conn('Mark As Processed') ]] },
    'Mark As Processed':         { main: [[ conn('Restore Bucket Payload') ]] },
    'Restore Bucket Payload':    { main: [[ conn('Switch Bucket') ]] },
    'Switch Bucket':             { main: [[ conn('Prepare Azure Tailor Body') ], [ conn('Split Jobs') ]] },
    'Prepare Azure Tailor Body': { main: [[ conn('Azure Tailor Resume') ]] },
    'Azure Tailor Resume':       { main: [[ conn('Parse Tailor Response') ]] },
    'Parse Tailor Response':     { main: [[ conn('Prepare Azure Cover Letter Body') ]] },
    'Prepare Azure Cover Letter Body': { main: [[ conn('Azure Cover Letter') ]] },
    'Azure Cover Letter':        { main: [[ conn('Parse Cover Letter Response') ]] },
    'Parse Cover Letter Response': { main: [[ conn('Build Packet Text') ]] },
    'Build Packet Text':         { main: [[ conn('Prep Binary Metadata') ]] },
    'Prep Binary Metadata':      { main: [[ conn('Upload Metadata') ]] },
    'Upload Metadata':           { main: [[ conn('Prep Binary JD') ]] },
    'Prep Binary JD':            { main: [[ conn('Upload JD') ]] },
    'Upload JD':                 { main: [[ conn('Convert Resume PDF') ]] },
    'Convert Resume PDF':        { main: [[ conn('Upload Resume') ]] },
    'Upload Resume':             { main: [[ conn('Convert Cover Letter PDF') ]] },
    'Convert Cover Letter PDF':  { main: [[ conn('Upload Cover Letter') ]] },
    'Upload Cover Letter':       { main: [[ conn('Assemble Airtable Row') ]] },
    'Assemble Airtable Row':     { main: [[ conn('Airtable Create Packet') ]] },
    'Airtable Create Packet':    { main: [[ conn('Build Telegram Approval') ]] },
    'Build Telegram Approval':   { main: [[ conn('Telegram Send Preview') ]] },
    'Telegram Send Preview':     { main: [[ conn('Split Jobs') ]] },
  };

  return wrap('Job Pipeline 02 — Score & Package', nodes, X);
}


// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW B — Telegram Approval Handler
// ═══════════════════════════════════════════════════════════════════════
function buildB() {
  const cfg = configLoader([220, 200]);

  const nodes = [
    N('Telegram Trigger', 'n8n-nodes-base.telegramTrigger', 1.1, [0, 200], {
      updates: ['message', 'callback_query'],
    }),
    ...cfg.nodes,

    code('Route Telegram Input', [660, 200], SRC.wfBRoute),

    N('IF Not Ignored', 'n8n-nodes-base.if', 2.2, [880, 200], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'ig', leftValue: '={{ $json.kind }}', rightValue: 'ignored',
          operator: { type: 'string', operation: 'notEquals' } }], combinator: 'and' },
    }),

    N('Switch Kind', 'n8n-nodes-base.switch', 3.2, [1100, 200], {
      rules: { values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'k1', leftValue: '={{ $json.kind }}', rightValue: 'callback',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'callback' },
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'k2', leftValue: '={{ $json.kind }}', rightValue: 'fix',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'fix' },
      ]},
      options: { fallbackOutput: 'extra' },
    }),

    // callback branch
    N('Answer Callback', 'n8n-nodes-base.httpRequest', 4.2, [1320, 100], {
      method: 'POST', url: tgUrl('answerCallbackQuery'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ callback_query_id: $('Route Telegram Input').first().json.callback_query_id, text: 'Processing...', show_alert: false }) }}`,
      options: {},
    }),

    AT('Find By AppId', [1540, 100], 'search', {
      filterByFormula: `={{ "{application_id}='" + $('Route Telegram Input').first().json.application_id + "'" }}`,
      returnAll: false, limit: 1, options: {},
    }),

    N('Switch Action', 'n8n-nodes-base.switch', 3.2, [1760, 100], {
      rules: { values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'a1',
              leftValue: `={{ $('Route Telegram Input').first().json.action }}`,
              rightValue: 'APPROVE_SUBMIT',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'approve' },
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'a2',
              leftValue: `={{ $('Route Telegram Input').first().json.action }}`,
              rightValue: 'REJECT',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'reject' },
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'a3',
              leftValue: `={{ $('Route Telegram Input').first().json.action }}`,
              rightValue: 'NEEDS_FIX',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'fix' },
      ]},
      options: { fallbackOutput: 'extra' },
    }),

    // approve
    AT('Airtable Approve', [1980, 0], 'update', {
      columns: { mappingMode: 'defineBelow', value: {
        id: '={{ $json.id }}', status: 'READY_TO_SUBMIT',
      }, matchingColumns: ['id'], schema: [] }, options: {},
    }),
    N('Execute Submission', 'n8n-nodes-base.executeWorkflow', 1.2, [2200, 0], {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: C('submission_workflow_id') },
      mode: 'each',
      options: { waitForSubWorkflow: true },
      workflowInputs: { mappingMode: 'defineBelow', value: {
        application_id: `={{ $('Route Telegram Input').first().json.application_id }}`,
      }},
    }),
    N('TG Confirm Approve', 'n8n-nodes-base.httpRequest', 4.2, [2420, 0], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: $('Config').first().json.telegram_chat_id, text: 'Approved & submission triggered: ' + $('Route Telegram Input').first().json.application_id }) }}`,
      options: {},
    }),

    // reject
    AT('Airtable Reject User', [1980, 200], 'update', {
      columns: { mappingMode: 'defineBelow', value: {
        id: '={{ $json.id }}', status: 'REJECTED_BY_USER',
      }, matchingColumns: ['id'], schema: [] }, options: {},
    }),
    N('TG Confirm Reject', 'n8n-nodes-base.httpRequest', 4.2, [2200, 200], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: $('Config').first().json.telegram_chat_id, text: 'Rejected: ' + $('Route Telegram Input').first().json.application_id }) }}`,
      options: {},
    }),

    // needs fix
    AT('Airtable Needs Fix', [1980, 380], 'update', {
      columns: { mappingMode: 'defineBelow', value: {
        id: '={{ $json.id }}', status: 'NEEDS_FIX',
      }, matchingColumns: ['id'], schema: [] }, options: {},
    }),
    N('TG Ask Fix', 'n8n-nodes-base.httpRequest', 4.2, [2200, 380], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: $('Config').first().json.telegram_chat_id, text: 'NEEDS_FIX: Reply with\\n/fix ' + $('Route Telegram Input').first().json.application_id + ' <correction>' }) }}`,
      options: {},
    }),

    // /fix command
    N('TG Fix Ack', 'n8n-nodes-base.httpRequest', 4.2, [1320, 380], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: $('Config').first().json.telegram_chat_id, text: 'Got /fix for ' + $json.application_id + '. Manual re-tailor for MVP.' }) }}`,
      options: {},
    }),
  ];

  const X = {
    'Telegram Trigger':     { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':         { main: [[ conn('Config') ]] },
    'Config':               { main: [[ conn('Route Telegram Input') ]] },
    'Route Telegram Input': { main: [[ conn('IF Not Ignored') ]] },
    'IF Not Ignored':       { main: [[ conn('Switch Kind') ], []] },
    'Switch Kind':          { main: [[ conn('Answer Callback') ], [ conn('TG Fix Ack') ]] },
    'Answer Callback':      { main: [[ conn('Find By AppId') ]] },
    'Find By AppId':        { main: [[ conn('Switch Action') ]] },
    'Switch Action':        { main: [[ conn('Airtable Approve') ], [ conn('Airtable Reject User') ], [ conn('Airtable Needs Fix') ]] },
    'Airtable Approve':     { main: [[ conn('Execute Submission') ]] },
    'Execute Submission':   { main: [[ conn('TG Confirm Approve') ]] },
    'Airtable Reject User': { main: [[ conn('TG Confirm Reject') ]] },
    'Airtable Needs Fix':   { main: [[ conn('TG Ask Fix') ]] },
  };

  return wrap('Job Pipeline B — Telegram Approval', nodes, X);
}


// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW C — Submission Executor
// ═══════════════════════════════════════════════════════════════════════
function buildC() {
  const cfg = configLoader([220, 200]);

  const nodes = [
    N('Execute Workflow Trigger', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 200], {
      inputSource: 'workflowInputs',
      workflowInputs: { values: [{ name: 'application_id', type: 'string' }] },
    }),
    ...cfg.nodes,

    AT('Airtable Load App', [660, 200], 'search', {
      filterByFormula: `={{ "{application_id}='" + $('Execute Workflow Trigger').first().json.application_id + "'" }}`,
      returnAll: false, limit: 1, options: {},
    }),

    code('Validate Submission', [880, 200], withS(SRC.wfCValidate)),
    code('Classify ATS', [1100, 200], SRC.wfCClassify),

    AT('Set Manual Required', [1320, 200], 'update', {
      columns: { mappingMode: 'defineBelow', value: {
        id: `={{ $('Airtable Load App').first().json.id }}`,
        status: 'MANUAL_REQUIRED',
        submission_mode: '={{ $json.submission_mode }}',
        notes: `={{ 'MVP executor: manual apply. Blocker: ' + $json.blocker }}`,
      }, matchingColumns: ['id'], schema: [] }, options: {},
    }),

    code('Build Result Text', [1540, 200], SRC.wfCResultTxt),
    codeAll('Prep Result Binary', [1760, 200], SRC.wfCResultBin),

    N('IF Has Folder', 'n8n-nodes-base.if', 2.2, [1980, 200], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'df', leftValue: '={{ $json.skip_upload }}', rightValue: false,
          operator: { type: 'boolean', operation: 'equals', singleValue: true } }], combinator: 'and' },
    }),

    ABU('Upload Result', [2200, 120], '={{ $json.drive_folder_id + \'/submission_result.txt\' }}'),

    N('TG Submission Notice', 'n8n-nodes-base.httpRequest', 4.2, [2420, 200], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: $('Config').first().json.telegram_chat_id, text: 'MANUAL SUBMISSION REQUIRED\\nApply: ' + ($('Airtable Load App').first().json.fields?.application_url || '') + '\\nResume: ' + ($('Airtable Load App').first().json.fields?.resume_link || '') + '\\nBlocker: ' + ($('Classify ATS').first().json.blocker || 'default') }) }}`,
      options: {},
    }),
  ];

  const X = {
    'Execute Workflow Trigger': { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':             { main: [[ conn('Config') ]] },
    'Config':                   { main: [[ conn('Airtable Load App') ]] },
    'Airtable Load App':        { main: [[ conn('Validate Submission') ]] },
    'Validate Submission':      { main: [[ conn('Classify ATS') ]] },
    'Classify ATS':             { main: [[ conn('Set Manual Required') ]] },
    'Set Manual Required':      { main: [[ conn('Build Result Text') ]] },
    'Build Result Text':        { main: [[ conn('Prep Result Binary') ]] },
    'Prep Result Binary':       { main: [[ conn('IF Has Folder') ]] },
    'IF Has Folder':            { main: [[ conn('Upload Result') ], [ conn('TG Submission Notice') ]] },
    'Upload Result':            { main: [[ conn('TG Submission Notice') ]] },
  };

  return wrap('Job Pipeline C — Submission Executor', nodes, X);
}


// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW D — Reporting
// ═══════════════════════════════════════════════════════════════════════
function buildD() {
  const cfg = configLoader([220, 200]);

  const nodes = [
    N('Every 3 hours', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 100], {
      rule: { interval: [{ field: 'hours', hoursInterval: 3 }] },
    }),
    N('Manual Report', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {}),
    ...cfg.nodes,

    AT('List Recent', [660, 200], 'search', {
      filterByFormula: "=IS_AFTER({last_updated}, DATEADD(TODAY(), -2, 'days'))",
      returnAll: true, options: {},
    }),
    codeAll('Compute Stats', [880, 200], withS(SRC.wfDStats)),
    N('TG Send Report', 'n8n-nodes-base.httpRequest', 4.2, [1100, 200], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ chat_id: $('Config').first().json.telegram_chat_id, text: $json.report_text }) }}`,
      options: {},
    }),
  ];

  const X = {
    'Every 3 hours':  { main: [[ conn('Fetch Config') ]] },
    'Manual Report':  { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':   { main: [[ conn('Config') ]] },
    'Config':         { main: [[ conn('List Recent') ]] },
    'List Recent':    { main: [[ conn('Compute Stats') ]] },
    'Compute Stats':  { main: [[ conn('TG Send Report') ]] },
  };

  return wrap('Job Pipeline D — Reporting', nodes, X);
}

// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW E — Manual URL -> Score -> Tailor -> Packet
// ═══════════════════════════════════════════════════════════════════════
function buildE() {
  // ── Layout grid (same convention as Workflow A) ───────────────────────
  // Workflow E mirrors A's packet/upload tail without the splitInBatches
  // loop, so the chain is shorter (~30 nodes) but still long enough that
  // a flat horizontal layout becomes ~6500 px wide. We snap to the same
  // 220 px grid, give the IF Has JD Text branches their own short lanes,
  // and wrap the upload + Telegram tail back under the main flow at
  // Y.WRAP, going right-to-left. Total canvas ends up ~4400 px wide.
  //
  // Vertical lanes:
  //   Y.PASTE   80  Manual JD paste branch (top output of IF Has JD Text)
  //   Y.MAIN   220  Trigger → Config → URL Input → IF → Score → Tailor → Cover → BPT
  //   Y.URL    360  Scrape Job URL + Normalize Manual URL Job (bottom branch of IF)
  //   Y.WRAP   620  Wrapped upload + Telegram tail (right-to-left)
  const COL = (i) => i * 220;
  const Y = { PASTE: 80, MAIN: 220, URL: 360, WRAP: 620 };

  const cfg = configLoader([COL(1), Y.MAIN]);

  const nodes = [
    N('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, [COL(0), Y.MAIN], {}),
    ...cfg.nodes,

    N('Manual URL Input', 'n8n-nodes-base.set', 3.4, [COL(3), Y.MAIN], {
      mode: 'manual',
      duplicateItem: false,
      assignments: { assignments: [
        { id: 'm1', name: 'job_url',         value: '', type: 'string' },
        { id: 'm2', name: 'job_description', value: '', type: 'string' },
        { id: 'm3', name: 'company',         value: '', type: 'string' },
        { id: 'm4', name: 'job_title',       value: '', type: 'string' },
      ]},
      includeOtherFields: true,
      options: {},
    }, { notesInFlow: true, notes: 'Two modes: (1) paste a URL into job_url and leave job_description empty → workflow scrapes the page; (2) paste raw JD text into job_description (optionally also company/job_title/job_url) → scraping is skipped.' }),

    N('IF Has JD Text', 'n8n-nodes-base.if', 2.2, [COL(4), Y.MAIN], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'jd', leftValue: '={{ $json.job_description }}', rightValue: '',
          operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and' },
    }),

    codeAll('Normalize Manual JD Paste', [COL(5), Y.PASTE], SRC.normManualPaste),

    N('Scrape Job URL', 'n8n-nodes-base.httpRequest', 4.2, [COL(5), Y.URL], {
      method: 'GET',
      url: '={{ $json.job_url }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      ]},
      responseFormat: 'text',
      options: { timeout: 20000, redirect: { redirect: { maxRedirects: 5 } } },
    }, { onError: 'continueRegularOutput' }),
    codeAll('Normalize Manual URL Job', [COL(6), Y.URL], SRC.normManualUrl),

    code('Prepare Azure Score Body', [COL(7), Y.MAIN], SRC.prepScore),
    N('Azure Fit Score', 'n8n-nodes-base.httpRequest', 4.2, [COL(8), Y.MAIN], {
      method: 'POST', url: azureUrl,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'api-key', value: C('azure_openai_api_key') },
        { name: 'Content-Type', value: 'application/json' },
      ]},
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.azure_body) }}',
      options: { timeout: 120000 },
    }),
    code('Parse Fit Score', [COL(9), Y.MAIN], SRC.parseScore),
    code('Score Bucket', [COL(10), Y.MAIN], SRC.scoreBucket),
    N('Switch Bucket', 'n8n-nodes-base.switch', 3.2, [COL(11), Y.MAIN], {
      rules: { values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'r1', leftValue: '={{ $json.bucket }}', rightValue: 'packet',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'packet' },
      ]},
      options: { fallbackOutput: 'extra' },
    }),
    code('Prepare Azure Tailor Body', [COL(12), Y.MAIN], SRC.prepTailor),
    N('Azure Tailor Resume', 'n8n-nodes-base.httpRequest', 4.2, [COL(13), Y.MAIN], {
      method: 'POST', url: azureUrl,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'api-key', value: C('azure_openai_api_key') },
        { name: 'Content-Type', value: 'application/json' },
      ]},
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.azure_body) }}',
      options: { timeout: 180000 },
    }),
    code('Parse Tailor Response', [COL(14), Y.MAIN], SRC.parseTailor),

    code('Prepare Azure Cover Letter Body', [COL(15), Y.MAIN], SRC.prepCoverLetter),
    N('Azure Cover Letter', 'n8n-nodes-base.httpRequest', 4.2, [COL(16), Y.MAIN], {
      method: 'POST', url: azureUrl,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'api-key', value: C('azure_openai_api_key') },
        { name: 'Content-Type', value: 'application/json' },
      ]},
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.azure_body) }}',
      options: { timeout: 120000 },
    }),
    code('Parse Cover Letter Response', [COL(17), Y.MAIN], SRC.parseCoverLetter),

    code('Build Packet Text', [COL(18), Y.MAIN], SRC.buildPacket),

    // ── Wrap row: upload + Telegram tail runs RIGHT-TO-LEFT under the
    // main flow at Y.WRAP. Drops straight DOWN from Build Packet Text
    // and walks back left to Telegram Send Preview. There's no loop in
    // this workflow so the chain ends at TSP — the wrap is purely to
    // keep the canvas compact.
    codeAll('Prep Binary Metadata', [COL(18), Y.WRAP], SRC.prepMetaBin),
    ABU('Upload Metadata', [COL(17), Y.WRAP], '={{ $json.folder_name + \'/application_metadata.json\' }}'),
    codeAll('Prep Binary JD', [COL(16), Y.WRAP], SRC.prepJdBin),
    ABU('Upload JD', [COL(15), Y.WRAP], '={{ $json.folder_name + \'/original_jd.md\' }}'),
    codeAll('Convert Resume PDF', [COL(14), Y.WRAP], SRC.convertResumePdf),
    ABU('Upload Resume', [COL(13), Y.WRAP], '={{ $json.folder_name + \'/\' + $json.resume_pdf_filename }}'),
    codeAll('Convert Cover Letter PDF', [COL(12), Y.WRAP], SRC.convertCoverLetterPdf),
    ABU('Upload Cover Letter', [COL(11), Y.WRAP], '={{ $json.folder_name + \'/\' + $json.cover_letter_pdf_filename }}'),
    code('Assemble Airtable Row', [COL(10), Y.WRAP], SRC.assembleRow),
    // Upsert (not create) to close the race window: if the same
    // `${source}::${source_job_id}` somehow reaches this node twice
    // (concurrent run, manual retry, etc.), the second write becomes an
    // UPDATE on the existing row instead of a duplicate.
    AT('Airtable Create Packet', [COL(9), Y.WRAP], 'upsert', {
      columns: { mappingMode: 'defineBelow', value: {
        application_id: '={{ $json.application_id }}',
        source_job_id: '={{ $json.source_job_id }}',
        company: '={{ $json.company }}',
        job_title: '={{ $json.job_title }}',
        location: '={{ $json.location }}',
        job_url: '={{ $json.job_url }}',
        application_url: '={{ $json.application_url }}',
        source: '={{ $json.source }}',
        date_found: '={{ $json.date_found }}',
        status: 'AWAITING_APPROVAL',
        fit_score: '={{ $json.fit_score }}',
        resume_link: '={{ $json.resume_link }}',
        jd_snapshot_link: '={{ $json.jd_snapshot_link }}',
        cover_letter_link: '={{ $json.cover_letter_link }}',
        submission_mode: 'MANUAL_REQUIRED',
        notes: '={{ $json.automation_note }}',
        next_action: 'Review Telegram approval',
        salary: '={{ $json.salary }}',
        remote_status: '={{ $json.remote_status }}',
        visa_notes: '={{ $json.visa_notes }}',
        drive_folder_id: '={{ $json.drive_folder_id }}',
      }, matchingColumns: ['source_job_id', 'source'], schema: [] }, options: {},
    }),
    code('Build Telegram Approval', [COL(8), Y.WRAP], SRC.tgPayload),
    N('Telegram Send Preview', 'n8n-nodes-base.httpRequest', 4.2, [COL(7), Y.WRAP], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.telegram_http_body) }}',
      options: {},
    }),
  ];

  const X = {
    'Manual Trigger':           { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':             { main: [[ conn('Config') ]] },
    'Config':                   { main: [[ conn('Manual URL Input') ]] },
    'Manual URL Input':         { main: [[ conn('IF Has JD Text') ]] },
    'IF Has JD Text':           { main: [[ conn('Normalize Manual JD Paste') ], [ conn('Scrape Job URL') ]] },
    'Normalize Manual JD Paste': { main: [[ conn('Prepare Azure Score Body') ]] },
    'Scrape Job URL':           { main: [[ conn('Normalize Manual URL Job') ]] },
    'Normalize Manual URL Job': { main: [[ conn('Prepare Azure Score Body') ]] },
    'Prepare Azure Score Body': { main: [[ conn('Azure Fit Score') ]] },
    'Azure Fit Score':          { main: [[ conn('Parse Fit Score') ]] },
    'Parse Fit Score':          { main: [[ conn('Score Bucket') ]] },
    'Score Bucket':             { main: [[ conn('Switch Bucket') ]] },
    'Switch Bucket':            { main: [[ conn('Prepare Azure Tailor Body') ], []] },
    'Prepare Azure Tailor Body': { main: [[ conn('Azure Tailor Resume') ]] },
    'Azure Tailor Resume':      { main: [[ conn('Parse Tailor Response') ]] },
    'Parse Tailor Response':    { main: [[ conn('Prepare Azure Cover Letter Body') ]] },
    'Prepare Azure Cover Letter Body': { main: [[ conn('Azure Cover Letter') ]] },
    'Azure Cover Letter':       { main: [[ conn('Parse Cover Letter Response') ]] },
    'Parse Cover Letter Response': { main: [[ conn('Build Packet Text') ]] },
    'Build Packet Text':        { main: [[ conn('Prep Binary Metadata') ]] },
    'Prep Binary Metadata':     { main: [[ conn('Upload Metadata') ]] },
    'Upload Metadata':          { main: [[ conn('Prep Binary JD') ]] },
    'Prep Binary JD':           { main: [[ conn('Upload JD') ]] },
    'Upload JD':                { main: [[ conn('Convert Resume PDF') ]] },
    'Convert Resume PDF':       { main: [[ conn('Upload Resume') ]] },
    'Upload Resume':            { main: [[ conn('Convert Cover Letter PDF') ]] },
    'Convert Cover Letter PDF': { main: [[ conn('Upload Cover Letter') ]] },
    'Upload Cover Letter':      { main: [[ conn('Assemble Airtable Row') ]] },
    'Assemble Airtable Row':    { main: [[ conn('Airtable Create Packet') ]] },
    'Airtable Create Packet':   { main: [[ conn('Build Telegram Approval') ]] },
    'Build Telegram Approval':  { main: [[ conn('Telegram Send Preview') ]] },
  };

  return wrap('Job Pipeline E — Manual URL Intake', nodes, X);
}


// ── write output ──────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'workflows');
fs.mkdirSync(outDir, { recursive: true });

const wfs = [
  ['00-shared-config.json',        build00()],
  ['01-job-sourcing.json',         buildSourcing()],
  ['02-job-score-package.json',    buildScoring()],
  ['03-telegram-approval.json',     buildB()],
  ['04-submission-executor.json',   buildC()],
  ['05-reporting.json',             buildD()],
  ['06-manual-url-intake.json',     buildE()],
];

for (const [file, wf] of wfs) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(wf, null, 2));
  const nc = Object.keys(wf.connections).length;
  console.log(`  ${file}  (${wf.nodes.length} nodes, ${nc} connections)`);
}
console.log('\nDone. Import order:');
console.log('  1) 00-shared-config.json   ← copy its workflow ID');
console.log('  2) Open Config node in 00, paste your real values');
console.log('  3) Import 01, 02, 03, 04, 05, 06');
console.log('  4) In each imported workflow: open "Fetch Config" → set workflow ID to 00\'s ID');
console.log('  5) In 00 Config: set scoring_workflow_id to 02\'s ID; submission_workflow_id to 04\'s ID');
console.log('  6) Attach Azure Storage (Shared Key) credential to all Azure Blob nodes in 02 + 04');
console.log('  7) Deploy md-to-pdf Azure Function (see azure-functions/md-to-pdf/README.md); set pdf_converter_url in 00 Config');
