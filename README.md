# sitegen-cms-orchestrator

Workflow for adding a Payload v3 CMS layer to existing static Astro landing pages under `optidigi/site-<slug>`. Sibling to `optidigi/sitegen-orchestrator`.

After running, the target site is Astro SSR (Node) reading per-tenant content from a mounted Payload data directory. Editor changes are visible on the next request — no GitHub Actions runs, no GitHub PATs, no webhook bridge in the editing path.

## Prerequisites

- A target `optidigi/site-<slug>` repo (built and deployed by `sitegen-orchestrator`).
- A self-hosted Payload v3 instance reachable from the operator's machine (e.g. `https://cms.optidigi.nl`).
- A Payload Management API token with scopes `tenant:create`, `user:create`, `page:create`, `media:create`, `siteSettings:create`. Generate it in Payload admin → API Keys → New token, granting all five scopes; copy into `.env` (see Setup below).
- A VPS host directory where Payload writes this tenant's content (typically `/srv/data/saas/payload-siab/<tenantId>/`). The site container will mount it read-only.
- Local tools: `gh` (authenticated as a member of `optidigi` — verify with `gh auth status`), `git`, `node` ≥ 20, `pnpm` (via `corepack`), `curl`, `jq`. (`python3` is used as an optional fallback for parsing `site.ts` if `pnpm dlx tsx` is unavailable.)

## Setup (fresh machine)

Clone the orchestrator wherever you want it.

```bash
git clone git@github.com:optidigi/sitegen-cms-orchestrator.git
cd sitegen-cms-orchestrator
cp .env.example .env
# Edit .env to set PAYLOAD_API_URL and PAYLOAD_API_TOKEN.
```

Run Claude Code from inside `sitegen-cms-orchestrator/`.

## Run a CMS-ification

Tell Claude `/add-cms <slug>` (e.g. `/add-cms amicare`). The agent reads `preflight.md`, asks you to confirm understanding, then reads `prompt.md` and walks the 10-phase runbook:

1. **Intake** — confirm `.env`, ask for VPS data path + (optional) client editor email.
2. **Clone & inspect** — `gh repo clone optidigi/site-<slug>`, derive metadata, idempotency check.
3. **Provision tenant** — POST to Payload's tenants API.
4. **Seed content** — `payload-seeder` subagent uploads media, posts pages and siteSettings.
5. **Convert site** — `site-converter` subagent does the SSR conversion surgery.
6. **Build verify** — `pnpm install && pnpm build`.
7. **Review** — `cms-reviewer` subagent audits.
8. **Invite editor** — POST to Payload users API; trigger forgot-password to send invite to `admin@optidigi.nl`.
9. **Sign-off + push** — show diff + compose snippet; on approval, push to main + watch GHA.
10. **Verify end-to-end** — operator updates VPS compose, confirms editor save → live round-trip.

There are GATEs in phases 1, 2, 9, and 10 that require explicit operator approval to proceed.

## Conventions this orchestrator mirrors from sitegen-orchestrator

- Workflow files: `CLAUDE.md`, `preflight.md`, `prompt.md`.
- Subagent specs in `.claude/agents/`.
- Slash command in `.claude/commands/`.
- Permissions in `.claude/settings.json` (allow safe ops, deny destructive global ops, ask for remote/recoverable destructive ops).
- The site repo is cloned per-engagement (as `./site-<slug>/`) and gitignored from this repo.

## Cleanup after a run

The cloned `./site-<slug>/` persists on disk for inspection. Remove manually when done:

```bash
rm -rf ./site-<slug>
```

The orchestrator never auto-deletes it.

## Re-running on a CMS-ified site

Not supported. The Phase 2 idempotency check bails. Manual reset path:

```bash
# 1. Inside the cloned site repo, revert all conversion commits:
cd ./site-<slug>
git reset --hard origin/main

# 2. Delete the local clone (Phase 2 refuses to start if it exists):
cd ..
rm -rf ./site-<slug>
```

Then in Payload admin: delete the tenant (and confirm any associated media/users were cascade-removed — if not, delete those too).

**VPS impact:** the previously-built `:latest` image is still serving editorial content from the (now-doomed) tenant's data dir. Before re-running `/add-cms <slug>`, decide whether to roll the live site back to a pre-CMS image (using a `sha-<short>` tag from `ghcr.io`) or accept that it will serve empty pages until the new conversion is pushed.

Once that's done, re-run `/add-cms <slug>` from the orchestrator dir.
