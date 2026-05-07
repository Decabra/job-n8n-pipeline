# Azure Functions Node 20 on Linux — Chromium installed for Playwright.
# Build: docker build -t md-to-pdf .
# See README.md for deployment steps.

FROM mcr.microsoft.com/azure-functions/node:4-node20-appservice

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=node \
    PLAYWRIGHT_BROWSERS_PATH=/home/site/wwwroot/ms-playwright

WORKDIR /home/site/wwwroot

COPY package.json package-lock.json ./
RUN npm ci \
  && npx playwright install chromium --with-deps

COPY host.json .
COPY src ./src

# Base image CMD starts the Functions host.
