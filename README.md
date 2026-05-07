# Job Application Pipeline — n8n Workflow-as-Code

An end-to-end job application pipeline built entirely on **self-hosted n8n**. It discovers jobs from multiple APIs, scores fit with an LLM, tailors your resume, generates a one-page PDF, and sends everything to Telegram for one-tap approval — all orchestrated as n8n workflows generated from version-controlled JavaScript.

## How it works

```
Job APIs ──► Dedupe ──► LLM Fit Score ──► Tailor Resume ──► PDF ──► Azure Blob
   │                                                                     │
   │         Airtable ◄──── Record + Status ◄────────────────────────────┤
   │                                                                     │
   └─────────────────── Telegram (Approve / Reject / Fix) ◄─────────────┘
```

**Five workflows, one config hub:**

| Workflow | Role |
|----------|------|
| **00 — Shared Config** | Central secrets and settings; called by all other workflows |
| **01 — Source, Score, Package** | Scheduled ingestion from JSearch, Apify, TheirStack → dedupe → LLM score → tailor → PDF → Airtable + Telegram |
| **02 — Telegram Approval** | Handles Approve / Reject / Needs Fix callbacks and `/fix` commands |
| **03 — Submission Executor** | Validates and classifies applications for submission (manual by default) |
| **04 — Reporting** | Periodic status summary to Telegram |
| **05 — Manual URL Intake** | Paste a URL or raw JD → same score/tailor/packet pipeline |

## What's in this repo

| Path | What it is |
|------|------------|
| `code-nodes/` | 25+ JavaScript files — the source code for every n8n Code node |
| `embed-workflows.mjs` | Reads `code-nodes/`, builds complete n8n workflow JSON programmatically |
| `azure-functions/md-to-pdf/` | Azure Function that converts Markdown → one-page PDF (Playwright + pdf-lib) |
| `.env.example` | Template for all required environment variables (no secrets) |

Workflows are **generated, not hand-edited** — run `node embed-workflows.mjs` and import the output into n8n.

## Key design choices

- **Workflow-as-code.** All n8n JSON is generated from `embed-workflows.mjs` + `code-nodes/`. No clicking through the UI — everything is reviewable in git.
- **Status enums.** `code-nodes/_statuses.js` defines every valid pipeline status (`S.AWAITING_APPROVAL`, `S.MANUAL_REQUIRED`, etc.). Code nodes reference `S.*` — never hardcoded strings. Frozen-status guards prevent duplicate ingestion from overwriting committed records.
- **Schema versioning.** `ensure-airtable-schema.js` bootstraps the Airtable table via the Meta API — creates missing fields, seeds single-select choices, and caches the result with a `SCHEMA_VERSION` + TTL so it only runs when the schema changes.
- **Multi-source dedup.** Three layers: in-batch dedupe, Airtable snapshot merge, and TheirStack credit-saving exclusions built from existing records.

## Prerequisites

You'll need accounts and credentials for these services:

| Service | What for | Env variable(s) |
|---------|----------|-----------------|
| **n8n** (self-hosted) | Workflow orchestration | — |
| **Airtable** | Application tracking (table is auto-created by schema bootstrap) | `AIRTABLE_BASE_ID`, `AIRTABLE_PAT` |
| **Azure Blob Storage** | Resume PDFs, JD files, metadata | `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER` |
| **Azure OpenAI** | Fit scoring and resume tailoring | `AZURE_OPENAI_RESOURCE`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` |
| **Telegram** | Approval notifications with inline buttons | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| **RapidAPI** | JSearch job source | `RAPIDAPI_KEY` |
| **TheirStack** (optional) | Additional job source | `THEIRSTACK_API_KEY` |
| **Apify** (optional) | Additional job source | `APIFY_TOKEN` |

See [`.env.example`](.env.example) for the full list with comments.

## Setup

### 1. Clone and configure environment

```bash
git clone <this-repo>
cd job-n8n-pipeline
cp .env.example .env
# Fill in your API keys and credentials in .env
```

### 2. Deploy the PDF function (optional but recommended)

The `azure-functions/md-to-pdf/` directory contains a containerized Azure Function that converts tailored Markdown resumes into one-page PDFs. See its [README](azure-functions/md-to-pdf/README.md) for deployment steps.

Once deployed, set `PDF_CONVERTER_URL` in your `.env`.

### 3. Generate workflow JSON

```bash
node embed-workflows.mjs
```

This reads every file in `code-nodes/`, embeds them into n8n workflow JSON, and writes the output to a local `workflows/` directory (gitignored — generated on demand).

### 4. Import into n8n

Import the generated JSON files **in order**:

1. `00-shared-config.json` — open the **Config** Set node and fill in your secrets/settings
2. `01-source-score-package.json`
3. `02-telegram-approval.json`
4. `03-submission-executor.json`
5. `04-reporting.json`
6. `05-manual-url-intake.json`

After importing:

- Copy the **Workflow 00** ID from the n8n URL bar → update the **Fetch Config** node in each workflow to point to it
- Open each **Airtable** and **Azure Storage** node → attach your n8n credentials
- Copy the **Workflow 03** ID → set `SUBMISSION_WORKFLOW_ID` in n8n env (or pick it in Workflow 02's Execute Workflow node)
- Set your base resume as `BASE_RESUME_TEXT` in the Config node (Markdown format)
- Activate Workflow **02** (Telegram trigger) and **01** (schedule) when ready

### 5. Telegram interaction

Once running, you'll receive Telegram messages for each scored job with three buttons:

- **Approve** → sets `READY_TO_SUBMIT`, triggers submission executor
- **Reject** → sets `REJECTED_BY_USER`
- **Needs Fix** → sets `NEEDS_FIX`, awaits `/fix` command

The `/fix` command accepts inline corrections:

```
/fix APP-xxxxx-abcd Emphasize Python and FastAPI experience
```

## Current limitations

- **Auto-submit is off.** Workflow 03 classifies the ATS but sets `MANUAL_REQUIRED` and sends you apply/resume links. Actual form submission is not automated.
- **NEEDS_FIX re-tailor** requires extending Workflow 02 with LLM + Storage nodes (the patterns mirror Workflow 01).

## License

MIT
