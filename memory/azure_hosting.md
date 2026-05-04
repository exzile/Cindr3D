---
name: Azure Hosting & Domain
description: Azure Static Web App resource details and the deferred cindr3d.com custom-domain plan
type: project
---

App is deployed to Azure Static Web Apps but the custom domain is intentionally **not connected yet** — the user wants to launch publicly when ready.

**How to apply:** When the user says "go live" or "connect the domain", pick up at the custom-domain steps below. Until then, just push to `master` and the staging URL updates automatically.

## Static Web App resource
| Field | Value |
|---|---|
| Resource | cindr3d |
| Resource group | rg-cindr3d |
| Subscription ID | b31e642b-39fb-4b56-b440-a951474ff912 |
| Region | eastus2 |
| SKU | Free |
| Staging URL | https://wonderful-tree-0f18e8c0f.7.azurestaticapps.net |
| GitHub repo | https://github.com/exzile/Cindr3D |
| Branch | master |
| Workflow | azure-static-web-apps-wonderful-tree-0f18e8c0f.yml |

Auto-deploys on every push to `master`.

## cindr3d.com custom-domain steps (when go-live is approved)
1. Azure Portal → cindr3d → Custom domains → + Add → `cindr3d.com`
2. Add the TXT validation record + apex CNAME at the registrar
3. Add `www` CNAME → `wonderful-tree-0f18e8c0f.7.azurestaticapps.net`
4. Wait for Azure to auto-provision the free TLS cert

Registrar holding `cindr3d.com` is unconfirmed — ask the user when starting this work.
