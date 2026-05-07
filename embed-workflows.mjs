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

// Shared status constants — prepended to code nodes that reference S.* / FROZEN_STATUSES / etc.
const STATUS_PREAMBLE = read('_statuses.js');
const withS = (src) => STATUS_PREAMBLE + '\n' + src;

const SRC = {
  explode:       read('explode-jsearch.js'),
  explodeApify:  read('explode-apify-dataset.js'),
  explodeTheirstack: read('explode-theirstack.js'),
  normalize:     read('normalize-job.js'),
  normApify:     read('normalize-apify.js'),
  mergeScrapedJd: read('merge-scraped-jd.js'),
  normTheirstack: read('normalize-theirstack.js'),
  normManualUrl: read('normalize-manual-url-job.js'),
  normManualPaste: read('normalize-manual-jd-paste.js'),
  filterStale:   read('filter-stale-jobs.js'),
  dedupeIncoming: read('dedupe-incoming-jobs.js'),
  sourceExclusions: read('build-source-exclusions.js'),
  prefetchDedup: read('prefetch-airtable-duplicates.js'),
  mergeDedup:    read('merge-dedup.js'),
  safeUpdate:    read('safe-airtable-update.js'),
  prepScore:     read('prepare-azure-score-body.js'),
  parseScore:    read('parse-fit-score.js'),
  scoreBucket:   read('score-bucket.js'),
  prepTailor:    read('prepare-azure-tailor-body.js'),
  parseTailor:   read('parse-tailor-response.js'),
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
        { id: 'c0',  name: 'airtable_base_id',        value: 'YOUR_AIRTABLE_BASE_ID',    type: 'string' },
        { id: 'c0b', name: 'airtable_table_name',     value: 'Jobs Application Tracker',  type: 'string' },
        { id: 'c0c', name: 'airtable_pat',            value: 'YOUR_AIRTABLE_PAT',         type: 'string' },
        { id: 'c0d', name: 'airtable_schema_cache_ttl_seconds', value: '86400', type: 'string' },
        { id: 'c1',  name: 'telegram_bot_token',      value: 'YOUR_TELEGRAM_BOT_TOKEN',  type: 'string' },
        { id: 'c2',  name: 'telegram_chat_id',        value: 'YOUR_TELEGRAM_CHAT_ID',    type: 'string' },
        { id: 'c3a', name: 'azure_storage_account',   value: 'YOUR_STORAGE_ACCOUNT_NAME', type: 'string' },
        { id: 'c3b', name: 'azure_storage_container', value: 'job-applications',         type: 'string' },
        { id: 'c4',  name: 'azure_openai_resource',   value: 'YOUR_AZURE_ENDPOINT_URL',  type: 'string' },
        { id: 'c5',  name: 'azure_openai_deployment', value: 'YOUR_DEPLOYMENT_NAME',     type: 'string' },
        { id: 'c5b', name: 'azure_openai_api_version', value: 'YOUR_AZURE_OPENAI_API_VERSION', type: 'string' },
        { id: 'c6',  name: 'azure_openai_api_key',    value: 'YOUR_AZURE_API_KEY',       type: 'string' },
        { id: 'c7',  name: 'rapidapi_key',            value: 'YOUR_RAPIDAPI_KEY',        type: 'string' },
        { id: 'c7j', name: 'job_search_queries',      value: 'YOUR_SEARCH_QUERIES', type: 'string' },
        { id: 'c7a', name: 'apify_token',             value: 'YOUR_APIFY_TOKEN',         type: 'string' },
        { id: 'c7v', name: 'theirstack_api_key',      value: 'YOUR_THEIRSTACK_API_KEY',  type: 'string' },
        { id: 'c7w', name: 'theirstack_limit',        value: '10',                     type: 'string' },
        { id: 'c8',  name: 'base_resume_text',        value: 'PASTE_YOUR_FULL_RESUME_HERE', type: 'string' },
        { id: 'c9',  name: 'submission_workflow_id',   value: 'YOUR_WORKFLOW_C_ID',       type: 'string' },
        { id: 'c9p', name: 'pdf_converter_url',        value: 'YOUR_AZURE_MD_TO_PDF_URL_WITH_CODE', type: 'string' },
        { id: 'c9r', name: 'resume_pdf_filename',       value: 'tailored_resume.pdf',    type: 'string' },
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
// WORKFLOW A — Source → Score → Package
// ═══════════════════════════════════════════════════════════════════════
// STATUS STRINGS in n8n node parameters below (e.g. 'AWAITING_APPROVAL',
// 'READY_TO_SUBMIT') MUST match code-nodes/_statuses.js.
// n8n expressions can't reference JS vars, so these stay as literals.
// ═══════════════════════════════════════════════════════════════════════
function buildA() {
  const cfg = configLoader([200, 200]);

  const nodes = [
    N('Manual Test', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {}),
    N('Twice daily ET', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 100], {
      rule: {
        interval: [{ field: 'cronExpression', expression: '0 13,19 * * *' }],
      },
      timezone: 'America/New_York',
    }, { notes: 'Runs 13:00 and 19:00 US Eastern (10:00 and 16:00 Pacific).', notesInFlow: true }),
    ...cfg.nodes,

    N('JSearch API', 'n8n-nodes-base.httpRequest', 4.2, [640, 140], {
      method: 'GET',
      url: 'https://jsearch.p.rapidapi.com/search',
      sendQuery: true,
      queryParameters: { parameters: [
        { name: 'query', value: "={{ $('Config').first().json.job_search_queries }}" },
        { name: 'page', value: '1' },
        { name: 'num_pages', value: '3' },
        { name: 'date_posted', value: 'today' },
      ]},
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'X-RapidAPI-Host', value: 'jsearch.p.rapidapi.com' },
        { name: 'X-RapidAPI-Key', value: C('rapidapi_key') },
      ]},
      options: { timeout: 120000 },
    }),

    N('Apify Job Pulse', 'n8n-nodes-base.httpRequest', 4.2, [640, 420], {
      method: 'POST',
      url: `={{ 'https://api.apify.com/v2/acts/myro-e54de05da1~job-pulse/runs?waitForFinish=180&token=' + encodeURIComponent($('Config').first().json.apify_token || '') }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ query: $('Config').first().json.job_search_queries || 'software engineer', location: 'United States', postedWithinDays: 1, maxResultsPerSource: 30, forceFresh: true, country: 'US' }) }}`,
      options: { timeout: 300000 },
    }),
    N('IF Apify Dataset', 'n8n-nodes-base.if', 2.2, [860, 420], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'ad', leftValue: '={{ $json.data.defaultDatasetId }}', rightValue: '',
          operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and' },
    }),
    N('Apify Fetch Dataset', 'n8n-nodes-base.httpRequest', 4.2, [1120, 340], {
      method: 'GET',
      url: `={{ 'https://api.apify.com/v2/datasets/' + $json.data.defaultDatasetId + '/items?clean=true&token=' + encodeURIComponent($('Config').first().json.apify_token || '') }}`,
      options: { timeout: 120000 },
    }),
    codeAll('Apify Skip No Dataset', [1120, 500], 'return [{ json: { _apify_skip: true } }];'),
    codeAll('Explode Apify Dataset', [1340, 420], SRC.explodeApify, { alwaysOutputData: true }),
    code('Normalize Apify Jobs', [1520, 420], SRC.normApify, 'runOnceForEachItem', { alwaysOutputData: true }),
    N('Scrape Apify JDs', 'n8n-nodes-base.httpRequest', 4.2, [1700, 420], {
      method: 'GET',
      url: '={{ $json.application_url || $json.job_url }}',
      options: { timeout: 15000, redirect: { redirect: { maxRedirects: 3 } }, batching: { batch: { batchSize: 3, batchInterval: 500 } } },
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        { name: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      ]},
      responseFormat: 'text',
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    codeAll('Merge Scraped JDs', [1880, 420], SRC.mergeScrapedJd, { alwaysOutputData: true }),

    codeAll('Seed Source Exclusions Prefetch', [640, 700], 'return [{ json: { prefetch_source_ids: true } }];'),
    // Separate list call used BEFORE TheirStack API request so we can pass job_id_not.
    AT(
      'Airtable List Existing (Source Exclusions)',
      [860, 700],
      'search',
      { returnAll: true, options: {} },
      { alwaysOutputData: true },
    ),
    codeAll('Build Source Exclusions', [1080, 700], SRC.sourceExclusions, { alwaysOutputData: true }),

    N('TheirStack Jobs API', 'n8n-nodes-base.httpRequest', 4.2, [1300, 700], {
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
      jsonBody: `={{ JSON.stringify({ page: 0, limit: Number($('Config').first().json.theirstack_limit || 10), posted_at_max_age_days: 1, job_country_code_or: ['US'], job_seniority_or: ['junior', 'mid_level'], job_title_pattern_or: ['AI.engineer', 'ML.engineer', 'LLM.engineer', 'machine.learning.engineer', 'data.engineer', 'software.engineer'], job_title_pattern_not: ['staff', 'principal', 'director', 'VP', 'head.of', 'intern', 'co.op'], job_description_pattern_or: ['LLM', 'RAG', 'agentic', 'AI.agent', 'embedding', 'GPT', 'langchain', 'vector'], job_description_pattern_not: ['security.clearance', 'TS/SCI', 'polygraph'], job_description_pattern_is_case_insensitive: true, employment_statuses_or: ['full_time'], job_id_not: $('Build Source Exclusions').first().json.theirstack_job_id_not || [], include_total_results: false, order_by: [{ desc: true, field: 'date_posted' }, { desc: true, field: 'discovered_at' }] }) }}`,
      options: { timeout: 30000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    codeAll('Explode TheirStack', [1520, 700], SRC.explodeTheirstack, { alwaysOutputData: true }),
    code('Normalize TheirStack Jobs', [1740, 700], SRC.normTheirstack, 'runOnceForEachItem', { alwaysOutputData: true }),

    N('Merge JSearch Apify', 'n8n-nodes-base.merge', 3, [2060, 280], { mode: 'append', options: {} }),
    N('Merge All Job Sources', 'n8n-nodes-base.merge', 3, [2240, 420], { mode: 'append', options: {} }),
    codeAll('Filter Stale Jobs', [2420, 420], SRC.filterStale, { alwaysOutputData: true }),
    codeAll('Dedupe Incoming Jobs', [2600, 420], SRC.dedupeIncoming, { alwaysOutputData: true }),

    codeAll('Explode JSearch', [860, 140], SRC.explode),
    codeAll('Normalize Jobs', [1240, 140], SRC.normalize),
    codeAll('Seed Airtable Prefetch', [2780, 420], 'return [{ json: { prefetch: true } }];'),
    // Node-level alwaysOutputData: 0 Airtable rows → 0 items → downstream never runs, yet run "succeeds".
    AT(
      'Airtable List Existing',
      [2960, 420],
      'search',
      { returnAll: true, options: {} },
      { alwaysOutputData: true },
    ),
    codeAll('Prefetch Dedup Snapshot', [3140, 420], SRC.prefetchDedup),
    N('Split Jobs', 'n8n-nodes-base.splitInBatches', 3, [3320, 540], { batchSize: 1, options: {} }),

    N('IF New Job', 'n8n-nodes-base.if', 2.2, [3560, 540], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'c1', leftValue: '={{ $json.is_duplicate }}', rightValue: false,
          operator: { type: 'boolean', operation: 'equals', singleValue: true } }],
        combinator: 'and' },
    }),

    // ── duplicate branch (skip logic is inside the code node; empty output = skip) ──
    codeAll('Safe Update Logic', [3560, 780], withS(SRC.safeUpdate)),
    AT('Update Dup Record', [3800, 780], 'update', {
      columns: { mappingMode: 'defineBelow', value: {
        id: '={{ $json.record_id }}',
        notes: '={{ $json.notes }}',
      }, matchingColumns: ['id'], schema: [] },
      options: {},
    }),

    // ── scoring branch ──
    code('Prepare Azure Score Body', [3800, 480], SRC.prepScore),
    N('Azure Fit Score', 'n8n-nodes-base.httpRequest', 4.2, [4020, 480], {
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
    code('Parse Fit Score', [4240, 480], SRC.parseScore),
    code('Score Bucket', [4460, 480], SRC.scoreBucket),

    N('Switch Bucket', 'n8n-nodes-base.switch', 3.2, [4680, 480], {
      rules: { values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'r1', leftValue: '={{ $json.bucket }}', rightValue: 'packet',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'packet' },
      ]},
      options: { fallbackOutput: 'extra' },
    }),

    // ── packet branch only (low scores: fallback → Split Jobs, no Airtable) ──
    code('Prepare Azure Tailor Body', [4920, 220], SRC.prepTailor),
    N('Azure Tailor Resume', 'n8n-nodes-base.httpRequest', 4.2, [5140, 220], {
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
    code('Parse Tailor Response', [5360, 220], SRC.parseTailor),
    code('Build Packet Text', [5580, 220], SRC.buildPacket),

    codeAll('Prep Binary Metadata', [5800, 80], SRC.prepMetaBin),
    ABU('Upload Metadata', [6020, 80], '={{ $json.folder_name + \'/application_metadata.json\' }}'),
    codeAll('Prep Binary JD', [5800, 320], SRC.prepJdBin),
    ABU('Upload JD', [6020, 320], '={{ $json.folder_name + \'/original_jd.md\' }}'),
    codeAll('Convert Resume PDF', [6240, 320], SRC.convertResumePdf),
    ABU('Upload Resume', [6460, 320], '={{ $json.folder_name + \'/\' + $json.resume_pdf_filename }}'),

    code('Assemble Airtable Row', [6680, 320], SRC.assembleRow),

    AT('Airtable Create Packet', [6900, 320], 'create', {
      columns: { mappingMode: 'defineBelow', value: {
        application_id: '={{ $json.application_id }}',
        source_job_id: '={{ $json.source_job_id }}',
        company: '={{ $json.company }}',
        job_title: '={{ $json.job_title }}', location: '={{ $json.location }}',
        job_url: '={{ $json.job_url }}', application_url: '={{ $json.application_url }}',
        source: '={{ $json.source }}', date_found: '={{ $json.date_found }}',
        status: 'AWAITING_APPROVAL', fit_score: '={{ $json.fit_score }}',
        resume_link: '={{ $json.resume_link }}', jd_snapshot_link: '={{ $json.jd_snapshot_link }}',
        cover_letter_link: '', submission_mode: 'MANUAL_REQUIRED',
        notes: '={{ $json.automation_note }}', next_action: 'Review Telegram approval',
        salary: '={{ $json.salary }}', remote_status: '={{ $json.remote_status }}',
        visa_notes: '={{ $json.visa_notes }}',
        drive_folder_id: '={{ $json.drive_folder_id }}',
      }, matchingColumns: [], schema: [] }, options: {},
    }),

    code('Build Telegram Approval', [7120, 320], SRC.tgPayload),

    N('Telegram Send Preview', 'n8n-nodes-base.httpRequest', 4.2, [7340, 320], {
      method: 'POST', url: tgUrl('sendMessage'),
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.telegram_http_body) }}',
      options: {},
    }),
  ];

  const X = {
    'Manual Test':               { main: [[ conn('Fetch Config') ]] },
    'Twice daily ET':            { main: [[ conn('Fetch Config') ]] },
    'Fetch Config':              { main: [[ conn('Config') ]] },
    'Config':                    { main: [[ conn('JSearch API'), conn('Apify Job Pulse'), conn('Seed Source Exclusions Prefetch') ]] },
    'Seed Source Exclusions Prefetch': { main: [[ conn('Airtable List Existing (Source Exclusions)') ]] },
    'Airtable List Existing (Source Exclusions)': { main: [[ conn('Build Source Exclusions') ]] },
    'Build Source Exclusions': { main: [[ conn('TheirStack Jobs API') ]] },
    'JSearch API':               { main: [[ conn('Explode JSearch') ]] },
    'Explode JSearch':           { main: [[ conn('Normalize Jobs') ]] },
    'Normalize Jobs':            { main: [[ connIn('Merge JSearch Apify', 0) ]] },
    'Apify Job Pulse':           { main: [[ conn('IF Apify Dataset') ]] },
    'IF Apify Dataset':          { main: [[ conn('Apify Fetch Dataset') ], [ conn('Apify Skip No Dataset') ]] },
    'Apify Fetch Dataset':       { main: [[ conn('Explode Apify Dataset') ]] },
    'Apify Skip No Dataset':     { main: [[ conn('Explode Apify Dataset') ]] },
    'Explode Apify Dataset':     { main: [[ conn('Normalize Apify Jobs') ]] },
    'Normalize Apify Jobs':      { main: [[ conn('Scrape Apify JDs') ]] },
    'Scrape Apify JDs':          { main: [[ conn('Merge Scraped JDs') ]] },
    'Merge Scraped JDs':         { main: [[ connIn('Merge JSearch Apify', 1) ]] },
    'Merge JSearch Apify':       { main: [[ connIn('Merge All Job Sources', 0) ]] },
    'TheirStack Jobs API':       { main: [[ conn('Explode TheirStack') ]] },
    'Explode TheirStack':        { main: [[ conn('Normalize TheirStack Jobs') ]] },
    'Normalize TheirStack Jobs': { main: [[ connIn('Merge All Job Sources', 1) ]] },
    'Merge All Job Sources':     { main: [[ conn('Filter Stale Jobs') ]] },
    'Filter Stale Jobs':         { main: [[ conn('Dedupe Incoming Jobs') ]] },
    'Dedupe Incoming Jobs':      { main: [[ conn('Seed Airtable Prefetch') ]] },
    'Seed Airtable Prefetch':    { main: [[ conn('Airtable List Existing') ]] },
    'Airtable List Existing':    { main: [[ conn('Prefetch Dedup Snapshot') ]] },
    'Prefetch Dedup Snapshot':   { main: [[ conn('Split Jobs') ]] },
    'Split Jobs':                { main: [[], [conn('IF New Job')]] },
    'IF New Job':                { main: [[ conn('Prepare Azure Score Body') ], [ conn('Safe Update Logic') ]] },
    'Safe Update Logic':         { main: [[ conn('Update Dup Record') ]] },
    'Update Dup Record':         { main: [[ conn('Split Jobs') ]] },
    'Prepare Azure Score Body':  { main: [[ conn('Azure Fit Score') ]] },
    'Azure Fit Score':           { main: [[ conn('Parse Fit Score') ]] },
    'Parse Fit Score':           { main: [[ conn('Score Bucket') ]] },
    'Score Bucket':              { main: [[ conn('Switch Bucket') ]] },
    'Switch Bucket':             { main: [[ conn('Prepare Azure Tailor Body') ], [ conn('Split Jobs') ]] },
    'Prepare Azure Tailor Body': { main: [[ conn('Azure Tailor Resume') ]] },
    'Azure Tailor Resume':       { main: [[ conn('Parse Tailor Response') ]] },
    'Parse Tailor Response':     { main: [[ conn('Build Packet Text') ]] },
    'Build Packet Text':         { main: [[ conn('Prep Binary Metadata') ]] },
    'Prep Binary Metadata':      { main: [[ conn('Upload Metadata') ]] },
    'Upload Metadata':           { main: [[ conn('Prep Binary JD') ]] },
    'Prep Binary JD':            { main: [[ conn('Upload JD') ]] },
    'Upload JD':                 { main: [[ conn('Convert Resume PDF') ]] },
    'Convert Resume PDF':        { main: [[ conn('Upload Resume') ]] },
    'Upload Resume':             { main: [[ conn('Assemble Airtable Row') ]] },
    'Assemble Airtable Row':     { main: [[ conn('Airtable Create Packet') ]] },
    'Airtable Create Packet':    { main: [[ conn('Build Telegram Approval') ]] },
    'Build Telegram Approval':   { main: [[ conn('Telegram Send Preview') ]] },
    'Telegram Send Preview':     { main: [[ conn('Split Jobs') ]] },
  };

  return wrap('Job Pipeline A — Source Score Package', nodes, X);
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
  const cfg = configLoader([220, 200]);

  const nodes = [
    N('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, [0, 200], {}),
    ...cfg.nodes,

    N('Manual URL Input', 'n8n-nodes-base.set', 3.4, [660, 200], {
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

    N('IF Has JD Text', 'n8n-nodes-base.if', 2.2, [840, 200], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'jd', leftValue: '={{ $json.job_description }}', rightValue: '',
          operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and' },
    }),

    codeAll('Normalize Manual JD Paste', [1060, 60], SRC.normManualPaste),

    N('Scrape Job URL', 'n8n-nodes-base.httpRequest', 4.2, [1060, 340], {
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
    codeAll('Normalize Manual URL Job', [1280, 340], SRC.normManualUrl),

    code('Prepare Azure Score Body', [1360, 200], SRC.prepScore),
    N('Azure Fit Score', 'n8n-nodes-base.httpRequest', 4.2, [1580, 200], {
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
    code('Parse Fit Score', [1800, 200], SRC.parseScore),
    code('Score Bucket', [2020, 200], SRC.scoreBucket),
    N('Switch Bucket', 'n8n-nodes-base.switch', 3.2, [2240, 200], {
      rules: { values: [
        { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'r1', leftValue: '={{ $json.bucket }}', rightValue: 'packet',
              operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          renameOutput: true, outputKey: 'packet' },
      ]},
      options: { fallbackOutput: 'extra' },
    }),
    code('Prepare Azure Tailor Body', [2460, 140], SRC.prepTailor),
    N('Azure Tailor Resume', 'n8n-nodes-base.httpRequest', 4.2, [2680, 140], {
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
    code('Parse Tailor Response', [2900, 140], SRC.parseTailor),
    code('Build Packet Text', [3120, 140], SRC.buildPacket),
    codeAll('Prep Binary Metadata', [3340, 40], SRC.prepMetaBin),
    ABU('Upload Metadata', [3560, 40], '={{ $json.folder_name + \'/application_metadata.json\' }}'),
    codeAll('Prep Binary JD', [3340, 240], SRC.prepJdBin),
    ABU('Upload JD', [3560, 240], '={{ $json.folder_name + \'/original_jd.md\' }}'),
    codeAll('Convert Resume PDF', [3780, 240], SRC.convertResumePdf),
    ABU('Upload Resume', [4000, 240], '={{ $json.folder_name + \'/\' + $json.resume_pdf_filename }}'),
    code('Assemble Airtable Row', [4220, 240], SRC.assembleRow),
    AT('Airtable Create Packet', [4440, 240], 'create', {
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
        cover_letter_link: '',
        submission_mode: 'MANUAL_REQUIRED',
        notes: '={{ $json.automation_note }}',
        next_action: 'Review Telegram approval',
        salary: '={{ $json.salary }}',
        remote_status: '={{ $json.remote_status }}',
        visa_notes: '={{ $json.visa_notes }}',
        drive_folder_id: '={{ $json.drive_folder_id }}',
      }, matchingColumns: [], schema: [] }, options: {},
    }),
    code('Build Telegram Approval', [4660, 240], SRC.tgPayload),
    N('Telegram Send Preview', 'n8n-nodes-base.httpRequest', 4.2, [4880, 240], {
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
    'Parse Tailor Response':    { main: [[ conn('Build Packet Text') ]] },
    'Build Packet Text':        { main: [[ conn('Prep Binary Metadata') ]] },
    'Prep Binary Metadata':     { main: [[ conn('Upload Metadata') ]] },
    'Upload Metadata':          { main: [[ conn('Prep Binary JD') ]] },
    'Prep Binary JD':           { main: [[ conn('Upload JD') ]] },
    'Upload JD':                { main: [[ conn('Convert Resume PDF') ]] },
    'Convert Resume PDF':       { main: [[ conn('Upload Resume') ]] },
    'Upload Resume':            { main: [[ conn('Assemble Airtable Row') ]] },
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
  ['01-source-score-package.json',  buildA()],
  ['02-telegram-approval.json',     buildB()],
  ['03-submission-executor.json',   buildC()],
  ['04-reporting.json',             buildD()],
  ['05-manual-url-intake.json',     buildE()],
];

for (const [file, wf] of wfs) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(wf, null, 2));
  const nc = Object.keys(wf.connections).length;
  console.log(`  ${file}  (${wf.nodes.length} nodes, ${nc} connections)`);
}
console.log('\nDone. Import order:');
console.log('  1) 00-shared-config.json   ← copy its workflow ID');
console.log('  2) Open Config node in 00, paste your real values');
console.log('  3) Import 01, 02, 03, 04, 05');
console.log('  4) In each: open "Fetch Config" node → set workflow ID to 00\'s ID');
console.log('  5) In 02: also set submission_workflow_id in 00 Config to 03\'s ID');
console.log('  6) Attach Azure Storage (Shared Key) credential to all Azure Blob nodes in 01 + 03');
console.log('  7) Deploy md-to-pdf Azure Function (see azure-functions/md-to-pdf/README.md); set pdf_converter_url in 00 Config');
