# Repository Guidelines

## Project Structure & Module Organization
- `src/app` – Next.js App Router (route groups, layouts, global styles).
- `src/components` UI building blocks; `src/hooks`, `src/lib`, `src/services`, `src/utils` for shared logic; types in `src/types`.
- `convex/` backend actions and `convex.json` deployment metadata.
- `public/` static assets and collection manifests (e.g., `public/collections/<id>/claim`).
- `scripts/inscribe/` inscription flows; `scripts/audit/` claim reconciliation; sample inputs in `temp/`.
- Long-form specs in `docs/`; experimental wallet in `sidebar-wallet-standalone/`.

## Build, Test, and Development Commands
- `npm run dev` – start local Next.js dev server with hot reload.
- `npm run build` / `npm run start` – build production assets, then serve for smoke tests.
- `npm run lint` – ESLint with Next config; fix with `next lint --fix`.
- `npm run pages:dev|build|deploy` – Cloudflare Pages pipeline via `@cloudflare/next-on-pages` and `wrangler`.
- `npm run audit:claims:export` – reproduce claim audit pipeline (use `temp/` for samples).
- In parallel: `npx convex dev` to exercise Convex functions (see `convex/testAction.ts`).

## Coding Style & Naming Conventions
- TypeScript with strict typing. Avoid `any`; prefer discriminated unions. Colocate shared types in `src/types`.
- Components `PascalCase` (e.g., `MintModal.tsx`); hooks `useCamelCase` (e.g., `useWallet`); utilities `camelCase` (e.g., `formatZecAmount`); env vars `SCREAMING_SNAKE_CASE`.
- Keep React files lean: render logic at top, derived helpers below; centralize Tailwind class lists near JSX. Use Tailwind + CSS Modules.
- Rely on ESLint + default Next formatter; ensure a clean `npm run lint` before PRs.

## Testing Guidelines
- No Jest yet. Quality relies on linting, manual flows, and targeted transaction harnesses.
- Inscription/claim work: run `node scripts/inscribe/test-simple-tx.js` and document expected outputs in PRs.
- UI: run `npm run dev` and verify collection detail and mint modals.
- Convex: run `npx convex dev` alongside the Next server when touching backend actions.

## Commit & Pull Request Guidelines
- Commits: short, imperative summaries (see `git log`), scoped to one functional change with a working build.
- PRs must include: concise description, affected routes/modules, testing notes (`npm run build`, scripts executed), linked issues/discussion IDs, and screenshots or terminal captures for UI/blockchain changes.

## Security & Configuration Tips
- Store secrets in `.env.local`. Never commit RPC keys or real customer data/whitelists.
- Review `public/collections/*/claim` before pushes to ensure only sample data.
- RPC scripts default to Zashi test nodes; use production credentials only via env vars.

