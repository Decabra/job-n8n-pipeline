# md-to-pdf Azure Function

HTTP `POST /api/md-to-pdf` — accepts `{ "markdown": "..." }`.
Used by n8n Workflow **01** to convert `tailored_resume_md` into `tailored_resume.pdf` before uploading to Azure Blob Storage.

## Architecture

```
markdown-it          Playwright (Chromium)        pdf-lib
Markdown ──────► HTML + CSS template ──────► PDF buffer
```

- **markdown-it** — Markdown → HTML parsing.
- **Playwright + Chromium** — headless browser renders styled HTML to PDF. A **singleton browser instance** is reused across requests (only the first request pays the ~1–3 s Chromium launch cost).
- **pdf-lib** — parses the generated PDF to validate exactly one page.
- **CSS template** — calibrated for US Letter, 0.5 in margins, 10 pt font; fits ~450–500 words on a single page.

## API

| | |
|---|---|
| **Endpoint** | `POST /api/md-to-pdf` |
| **Auth** | Function key via `?code=` query param (`authLevel: function`) |
| **Request body** | `{ "markdown": "# Jane Doe\n\n## Skills\n..." }` |
| **Success** | `200`, `Content-Type: application/pdf`, body = raw PDF bytes |
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

Expected: `HTTP=200`, size ~15–25 KB, time ~1–3 s. Open `test-output.pdf` to verify a single-page resume.

### Redeploying after code changes

```bash
cd azure-functions/md-to-pdf
az acr login --name YOUR_ACR
docker build -t YOUR_ACR.azurecr.io/md-to-pdf:latest .
docker push YOUR_ACR.azurecr.io/md-to-pdf:latest
az functionapp restart --name YOUR_APP --resource-group YOUR_RG
```

## Local development

Prerequisites: [Azure Functions Core Tools v4](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local), Node 20.

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
| **Chromium missing at runtime** | Dockerfile must run `npx playwright install chromium --with-deps`. Verify `PLAYWRIGHT_BROWSERS_PATH` matches. |

## Security

- The function URL (with `?code=`) is a **secret**. Store it in `.env` / n8n Config, never commit it.
- Optional: front with Azure API Management or Entra ID for header-based auth instead of query-string keys.
