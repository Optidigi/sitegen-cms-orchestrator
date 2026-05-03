# sitegen-cms-orchestrator — Claude Code conventions

You are operating the **sitegen-cms** workflow: adding a Payload v3 CMS layer to an existing static Astro landing-page site under `optidigi/site-<slug>`. This orchestrator is a peer of `sitegen-orchestrator`, not its child. After running, the site renders editorial content from a per-tenant data directory mounted into its container at runtime, with no GitHub credentials or GHA runs in the editing path.

## Repos in this workspace

You operate from the orchestrator root (the directory holding this `CLAUDE.md`). Per-engagement site clones live as gitignored child dirs alongside it.

- `./` — this orchestrator. Holds CLAUDE.md, preflight.md, prompt.md, .claude/.
- `./site-<slug>/` — per-engagement working copy. Created by `gh repo clone`, modified locally, pushed back to `optidigi/site-<slug>` `main` at the sign-off gate. Persists on disk after the run for inspection.

## Subagents available

- `payload-seeder` — markdown + site-data → Payload pages, media, siteSettings via REST. Dispatch in Phase 4.
- `site-converter` — surgical SSR conversion of the cloned site. Dispatch in Phase 5.
- `cms-reviewer` — post-conversion audit. Dispatch in Phase 7. Uses `code-reviewer` agent type as base.

See `.claude/agents/*.md` for input/output contracts.

## Hard rules

1. Read `preflight.md` first when starting a CMS-ification. Summarize back what you understood. Wait for user confirmation.
2. Then read `prompt.md` and run the 10-phase runbook.
3. Never modify any of the four sibling repos (`sitegen-orchestrator`, `sitegen-template`, `sitegen-themes`, the source `site-<slug>` on disk before this run started). The cloned `./site-<slug>/` is yours to modify.
4. Never push to `main` of `optidigi/site-<slug>` until the user has approved the sign-off gate (Phase 9).
5. Never delete the Payload tenant or its content during a run, including on failure. Operator's call only.
6. Markdown files in the cloned site's `src/content/pages/` are deleted in the same commit as the SSR conversion (Phase 5). Do NOT leave them behind. Source of truth becomes Payload.
7. Defensive rendering everywhere in the converted site: every CMS field accessed must use `?.` and a fallback. Missing data must never crash a page.
8. Commit message style: `feat:` / `chore:` / `docs:` lowercase prefixes, terse summaries. **No "Generated with Claude Code" footers anywhere.**
9. VPS-side compose / nginx vhost / TLS / DNS are out of scope. Help diagnose if asked, don't SSH.

## Quality floors (the converted site must meet these before sign-off)

- `pnpm build` succeeds (Astro server bundle compiles)
- `cms-reviewer` reports `Status: clean`
- All security headers from the original `nginx.conf` are present in `src/middleware.ts`
- `/healthz` route returns 200 unconditionally (independent of CMS data)
- No `getEntry` / `getCollection` / `astro:content` imports remain in the codebase
- Every reference to CMS data in templates uses defensive access patterns

## Re-engagements

If a CMS-ified site needs CMS-related changes weeks later (e.g., parallel workstream's schema changed), this orchestrator does NOT support a "patch existing CMS-ified site" mode. Operator must manually revert the site repo (`git reset --hard origin/main` after deleting local clone), delete the Payload tenant, then re-run `/add-cms <slug>`. The Phase 2 idempotency check enforces this.

## Where the design lives

Full design spec: `docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md`. When in doubt about WHY something is done a particular way, that document is the source of truth.
