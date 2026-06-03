# Release Checklist

Use this checklist before merging release PRs and before any emergency hotfix to `master`.

## Required Checks

```bash
npm run typecheck
npm run lint
npm run test:run
npm run i18n:check
npm run build
npm run deploy:check
npx gitnexus detect-changes --repo Cindr3D
```

`npm run deploy:check` verifies that the built Static Web Apps config is copied from `public/staticwebapp.config.json`, that the production CSP includes the OpenCascade-required `script-src` tokens, and that a production-style browser smoke test can load the built OpenCascade bundle under those headers.

## Deploy Config

`public/staticwebapp.config.json` is the single source of truth for Azure Static Web Apps headers and routing. Vite copies it into `dist/staticwebapp.config.json` during the build.

Do not add another `staticwebapp.config.json` at the repository root. Duplicate config files can drift and ship the wrong production headers.

## Hotfix Flow

1. Pull latest `master`.
2. Apply the smallest safe fix.
3. Run the required checks above.
4. Confirm `npm run deploy:check` passes against the freshly built `dist/` output.
5. Push or merge the fix using the fastest approved path for the incident.
