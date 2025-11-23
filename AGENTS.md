# Repository Guidelines

## Project Structure & Module Organization
`src/app` hosts the Next.js app router with route groups, layouts, and global styles. UI building blocks live in `src/components`, while shared config, contexts, hooks, lib helpers, services, and utils are split into similarly named folders for easier ownership. Convex backend actions reside in `convex/` with its deployment metadata in `convex.json`. Static assets (including collection manifests) sit under `public/`, and blockchain automation or auditing helpers live in `scripts/`—notably `scripts/inscribe/` for inscription flows and `scripts/audit/` for claim reconciliation. Long-form specs belong in `docs/`, and experimental wallet tooling is isolated in `sidebar-wallet-standalone/`.

## Build, Test, and Development Commands
- `npm run dev` – launches the local Next.js dev server with hot reload.
- `npm run build` / `npm run start` – compiles production assets and serves them for smoke tests.
- `npm run lint` – runs ESLint with the Next.js config; treat failures as blockers.
- `npm run pages:dev|build|deploy` – targets the Cloudflare Pages build pipeline via `@cloudflare/next-on-pages` and `wrangler`.
- `npm run audit:claims:export` – reproduces the claim audit pipeline; keep sample inputs under `temp/`.

## Coding Style & Naming Conventions
Use TypeScript across the app with strict typing—avoid `any`, prefer discriminated unions for protocol state, and colocate types in `src/types`. Components are `PascalCase`, hooks `useCamelCase`, utilities `camelCase`, and environment variables `SCREAMING_SNAKE_CASE`. Keep React files lean: render logic at top, derived helpers below, and tailwind class lists centralized near JSX. Follow Tailwind + CSS Modules already configured, and rely on ESLint + the default Next formatter (`next lint --fix`) before sending code for review.

## Testing Guidelines
There is no Jest suite yet; quality relies on linting, manual flows, and targeted transaction harnesses. For inscription or claim work, replicate the relevant script under `scripts/inscribe/` (e.g., `node scripts/inscribe/test-simple-tx.js`) and document expected outputs in the PR. UI regressions should be caught by loading `npm run dev` and verifying core pages, especially collection detail and mint modals. When touching Convex functions, run `npx convex dev` alongside the Next server to exercise `convex/testAction.ts`.

## Commit & Pull Request Guidelines
Commits follow a short, imperative summary style (see `git log`: “Fix claim blocking and add lean stats system”). Keep them scoped to one functional change set with working builds. Pull requests must include: concise description, affected routes/modules, testing notes (`npm run build`, scripts executed), linked issues or discussion IDs, and screenshots or terminal captures for UI or blockchain changes. Draft PRs are encouraged for large features.

## Security & Configuration Tips
Secrets live in `.env.local`; never commit RPC keys or whitelist CSVs with real customer data. Review `public/collections/*/claim` before pushes to ensure sample data only. RPC-facing scripts should default to Zashi test nodes unless production credentials are explicitly supplied via env vars.
