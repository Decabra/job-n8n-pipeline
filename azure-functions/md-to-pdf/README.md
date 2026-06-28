# md-to-pdf Azure Function

HTTP `POST /api/md-to-pdf` — accepts `{ "markdown": "..." }`.
Used by n8n Workflow **01** to convert `tailored_resume_md` into `tailored_resume.pdf` before uploading to Azure Blob Storage.

## Architecture

```
markdown-it          Playwright (Chromium)        pdf-lib
Markdown ──────► HTML + CSS template ──────► PDF buffer
```

- **markdown-it** — Markdown → HTML parsing.
- **Playwright + Chromium** — headless browser renders styled HTML to PDF. Experience roles (`h3` + bullets) are wrapped in unbreakable table shells **after** markdown-it renders (injecting tables in markdown source does not work). A virtual-page pass adds `page-break-before` when a role would straddle the page bottom.
- **CSS template** — US Letter, 0.5 in body padding, 10 pt font; resumes are typically 2 pages when tailored.

## API

| | |
|---|---|
| **Endpoint** | `POST /api/md-to-pdf` |
| **Auth** | Function key via `?code=` query param (`authLevel: function`) |
| **Request body** | `{ "markdown": "# Jane Doe\n\n## Skills\n..." }` |
| **Success** | `200`, `Content-Type: application/pdf`, `X-Resume-Pdf-Version` header (layout version), body = raw PDF bytes |
| **Errors** | `400` bad/missing body, `413` markdown too large, `500` internal |

## Deployment

### Prerequisites

- **Docker Desktop** running
- **Azure CLI** (`az`) logged in
- An **Azure Resource Group**
- An **Azure Container Registry** (ACR) with admin access enabled
- An **Azure Storage Account**

### Steps

Replace placeholders (`YOUR_ACR`, `YOUR_RG`, `YOUR_STORAGE`, `YOUR_APP`) with your actual resource names.

```bash
# 1. Log in to your container registry
az acr login --name YOUR_ACR

# 2. Build and push the Docker image
cd azure-functions/md-to-pdf
docker build -t YOUR_ACR.azurecr.io/md-to-pdf:latest .
docker push YOUR_ACR.azurecr.io/md-to-pdf:latest

# 3. Get ACR credentials
az acr credential show --name YOUR_ACR \
  --query "{username:username,password:passwords[0].value}" -o json

# 4. Create an App Service Plan (Linux, B1 minimum for custom containers)
az appservice plan create \
  --name md-to-pdf-plan --resource-group YOUR_RG --sku B1 --is-linux

# 5. Create the Function App (replace <ACR_PASSWORD> from step 3)
az functionapp create \
  --name YOUR_APP \
  --resource-group YOUR_RG \
  --storage-account YOUR_STORAGE \
  --plan md-to-pdf-plan \
  --image YOUR_ACR.azurecr.io/md-to-pdf:latest \
  --registry-username YOUR_ACR \
  --registry-password "<ACR_PASSWORD>"

# 6. Set required app settings
az functionapp config appsettings set \
  --name YOUR_APP --resource-group YOUR_RG \
  --settings "FUNCTIONS_WORKER_RUNTIME=node"

# 7. Enable AlwaysOn (prevents cold starts)
az webapp config set --name YOUR_APP --resource-group YOUR_RG --always-on true

# 8. Create required storage containers (idempotent)
az storage container create --name azure-webjobs-hosts --account-name YOUR_STORAGE --auth-mode key
az storage container create --name azure-webjobs-secrets --account-name YOUR_STORAGE --auth-mode key
```

First deploy takes **2–5 minutes** while Azure pulls the ~1.5 GB image. Monitor with:

```bash
az webapp log tail --name YOUR_APP --resource-group YOUR_RG --provider docker
```

Look for `Application started.` — that means it's ready.

### Get the function key

```bash
az functionapp keys list --name YOUR_APP --resource-group YOUR_RG \
  --query "functionKeys.default" -o tsv
```

### Smoke test

```bash
curl -s -w "\nHTTP=%{http_code} SIZE=%{size_download} TIME=%{time_total}s" \
  -X POST "https://YOUR_APP.azurewebsites.net/api/md-to-pdf?code=YOUR_FUNCTION_KEY" \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Jane Doe\n\n## Skills\nPython, Azure\n\n## Experience\n\n### Engineer - ACME\n- Built APIs"}' \
  -o test-output.pdf
```

Expected: `HTTP=200`, header `X-Resume-Pdf-Version: 2026-06-27-role-shells` (or newer), size ~15–80 KB.

**Verify deploy after push:** if your pipeline PDF still splits experience bullets across pages, the Azure container is almost certainly still running an old image. Check the version header:

```bash
curl -sD - -o /dev/null -X POST "https://YOUR_APP.azurewebsites.net/api/md-to-pdf?code=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Test\n\n## Experience\n\n### Engineer, ACME *Remote · 2024*\n\n- Bullet one\n- Bullet two"}' \
  | grep -i x-resume-pdf-version
```

Run layout regression locally before pushing:

```bash
cd azure-functions/md-to-pdf
npm test
```

### Redeploying after code changes

```bash
cd azure-functions/md-to-pdf
az acr login --name YOUR_ACR
docker build -t YOUR_ACR.azurecr.io/md-to-pdf:latest .
docker push YOUR_ACR.azurecr.io/md-to-pdf:latest
az functionapp restart --name YOUR_APP --resource-group YOUR_RG
```

## Local development (validate before every deploy)

**Do not push to Azure until `npm test` passes.** The test runs the same `markdownToPdf` code as production, writes a real PDF, extracts text per page, and fails if any experience role splits across pages (the Une Soumission bug).

Prerequisites: Node 20, Chromium for Playwright.

```bash
cd azure-functions/md-to-pdf
npm ci
npx playwright install chromium
npm test
```

What `npm test` checks against `resumes/Sarmad_Sohail_Resume.md` (repo source of truth — same content as n8n `base_resume_text`):

- Experience roles do not split across pages
- Every `[text](url)` markdown link is embedded in the PDF

Render for manual inspection (defaults to the same resume file):

```bash
npm run render
# → out/resume-preview.pdf

npm run render -- ../../../resumes/Sarmad_Sohail_Resume.md -o /tmp/resume.pdf
```

### Why page breaks are annoying

Chromium's PDF engine treats `page-break-inside: avoid` as a **hint**, not a rule. A plain `h3` + `ul` pair will soft-break between bullets when the role lands near the page bottom. Markdown-in-HTML-table tricks fail because markdown-it closes HTML blocks before `###` headings. The fix is two steps only:

1. Wrap each `h3 + ul` in a table shell **after** markdown-it renders (`resumeBlocks.js`)
2. If a shell would straddle a page, add `page-break-before: always` on the whole block (`applyResumePageBreaks`)

### Azure Functions local HTTP (optional)

Prerequisites: [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local).

```bash
cd azure-functions/md-to-pdf
cp local.settings.json.example local.settings.json
npm ci
npx playwright install chromium --with-deps
func start
```

Test against `http://localhost:7071/api/md-to-pdf`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **401 Unauthorized** | Function key changed (happens when storage account changes). Re-fetch with `az functionapp keys list`. |
| **404 Not Found** | Container still starting. Wait for `Application started` in logs. |
| **Requests hang** | Container restarting or image being pulled. Check docker logs. Restart with `az functionapp restart`. |
| **Empty `DOCKER_REGISTRY_SERVER_PASSWORD`** | ACR password wasn't saved during creation. Re-set it in app settings. |
| **Experience role split across pages** | Redeploy Docker image (see above) and confirm `X-Resume-Pdf-Version` header. Old images had no post-render role wrapping. |

## Security

- The function URL (with `?code=`) is a **secret**. Store it in `.env` / n8n Config, never commit it.
- Optional: front with Azure API Management or Entra ID for header-based auth instead of query-string keys.
