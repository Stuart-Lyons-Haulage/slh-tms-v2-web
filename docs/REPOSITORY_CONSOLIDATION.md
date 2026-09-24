# Repository consolidation audit

Date: 2026-09-23

## Archived V1

The final V1 production line is preserved at `origin/main` in both repositories:

- API: `archive/v1-final-2026-09-23` / tag `archive/v1-final-2026-09-23`
- Web: `archive/v1-final-2026-09-23` / tag `archive/v1-final-2026-09-23`

The archive is local until the release owner chooses to push it.

## Active desktop-shell path

The root web package is the recovered desktop shell. Its `package.json`, Vite config, Playwright config, Vitest config, `src/`, `e2e/`, and root CI workflow form the single active frontend/test path on this branch.

The former `web/v2` package was a separate foundation portal. It had its own entry point, package manifest, Vite server, `/api/v2` client and CI workflow, and was not imported by the desktop shell. It has been removed from this branch. Its historical commits remain available through Git refs.

## API retention decisions

The root API `Controllers/`, `Services/`, models and root test project were not deleted. The desktop shell currently calls `/api/v1/*`, and the API also has Power Automate, scheduled-job, integration and deployment consumers. ASP.NET controller discovery makes directory appearance an unsafe dead-code test.

The root API is the unified API path. The current frontend calls its `/api/v2/*` contract, and the root API test project covers that contract. The former nested `api/v2/Slh.Tms.V2.Api` foundation and its local-only workflow were removed by the API cleanup after reference checks; its local schema assets were retained under `api/local/`.

## Remaining migration boundary

The combined repositories now have one frontend package, one root API project, and one API test project. The old V1 production state remains recoverable through the archive refs; the active application contract is the root API `/api/v2` surface used by the desktop shell.
