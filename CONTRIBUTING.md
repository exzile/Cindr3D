# Contributing to Cindr3D

Thanks for taking the time to improve Cindr3D.

## Development Setup

Requirements:

- Node.js 22 or newer
- npm

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Run checks before opening a pull request:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

## Pull Requests

- Keep changes focused and describe the user-facing behavior they affect.
- Include tests when changing shared logic, import/export behavior, geometry operations, slicer behavior, or printer integration.
- Avoid committing local build output, editor state, personal assistant files, device credentials, or generated caches.
- For UI work, keep the existing professional CAD-style interaction model and visual density.

## Issues

Useful bug reports include:

- Browser and operating system
- Steps to reproduce
- Expected result
- Actual result
- Console errors, if any
- Example files, if the issue involves import/export or slicing

## Security

Please do not report security issues in public issues. See `SECURITY.md`.
