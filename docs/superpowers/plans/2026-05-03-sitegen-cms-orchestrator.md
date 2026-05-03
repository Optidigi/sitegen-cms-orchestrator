# Sitegen CMS Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workflow files for `optidigi/sitegen-cms-orchestrator` so an operator can run `/add-cms <slug>` against an existing `optidigi/site-<slug>` repo and have the orchestrator transform it into a CMS-backed Astro SSR site driven by Payload v3, per the design at `docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md`.

**Architecture:** Pure workflow repo — no runtime code, just markdown files that drive Claude Code through 10 phases (intake, clone, provision, seed, convert, build, review, invite, push, verify). The orchestrator clones the target site as a gitignored sibling dir at runtime, modifies it locally, and pushes back to the same `optidigi/site-<slug>` origin only after operator sign-off. Three subagent specialists (`payload-seeder`, `site-converter`, `cms-reviewer`) handle the meaty work; tenant create + editor invite are inline curl calls.

**Tech Stack:** Plain markdown for all workflow files. JSON for `.claude/settings.json` and `.mcp.json`. No package manager, no build, no runtime — just files that Claude Code reads when an operator engages the workflow.

**Convention notes:**
- Commit messages use `feat:`, `chore:`, `docs:` prefixes, lowercase summaries. NO "Generated with Claude Code" footers.
- Working directory throughout: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/` (already a git repo with the spec committed).
- Always quote heredocs and keep file contents complete — the operator will read these files verbatim and trust them.

---

## File Layout (created by this plan)

```
sitegen-cms-orchestrator/
├── .gitignore
├── .mcp.json
├── .env.example
├── README.md
├── CLAUDE.md
├── preflight.md
├── prompt.md
├── .claude/
│   ├── settings.json
│   ├── agents/
│   │   ├── payload-seeder.md
│   │   ├── site-converter.md
│   │   └── cms-reviewer.md
│   └── commands/
│       └── add-cms.md
└── docs/superpowers/
    ├── specs/2026-05-03-sitegen-cms-orchestrator-design.md   (already committed)
    └── plans/2026-05-03-sitegen-cms-orchestrator.md           (this file)
```

---

## Task 1: Repo skeleton

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.gitignore`
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.env.example`
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.mcp.json`

**Why:** Foundation files. The `.gitignore` excludes per-engagement site clones and operator secrets. `.env.example` documents the two env vars the orchestrator needs. `.mcp.json` is project-scoped MCP config (currently empty, mirrors sitegen-orchestrator).

- [ ] **Step 1: Create `.gitignore`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.gitignore`:

```gitignore
# Per-engagement site clones (have their own git, gitignored from orchestrator)
/site-*/

# Per-client raw materials, wherever the user drops them locally
/client-input/
/_clients/

# Operator secrets
.env

# Local Claude state
.claude/projects/
.claude/shell-snapshots/
.claude/todos/
.claude/statsig/
.claude/ide/

# OS / editor noise
.DS_Store
Thumbs.db
*.swp
.idea/
.vscode/
```

- [ ] **Step 2: Create `.env.example`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.env.example`:

```bash
# Payload v3 instance for the operator's CMS
# (e.g., https://cms.optidigi.nl)
PAYLOAD_API_URL=

# Payload Management API token with scopes:
#   tenant:create, user:create, page:create, media:create, siteSettings:create
# Generated in Payload admin -> API Keys; do not commit the real value.
PAYLOAD_API_TOKEN=
```

- [ ] **Step 3: Create `.mcp.json`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.mcp.json`:

```json
{
  "mcpServers": {}
}
```

- [ ] **Step 4: Verify files exist and are well-formed**

Run:
```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
ls -la .gitignore .env.example .mcp.json
python3 -c 'import json; json.load(open(".mcp.json"))' && echo "mcp.json OK"
```

Expected output: three files listed, "mcp.json OK" printed.

- [ ] **Step 5: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add .gitignore .env.example .mcp.json
git commit -m "chore: initialize repo skeleton with gitignore, env example, mcp config"
```

---

## Task 2: CLAUDE.md (auto-loaded conventions)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/CLAUDE.md`

**Why:** Auto-loaded by Claude Code on session start. Concise list of high-level conventions, hard rules, and the read-preflight-then-prompt sequence that every run follows. Mirrors `sitegen-orchestrator/CLAUDE.md` shape.

- [ ] **Step 1: Write `CLAUDE.md`**

Write the file with this content:

```markdown
# sitegen-cms-orchestrator — Claude Code conventions

You are operating the **sitegen-cms** workflow: adding a Payload v3 CMS layer to an existing static Astro landing-page site under `optidigi/site-<slug>`. This orchestrator is a peer of `sitegen-orchestrator`, not its child. After running, the site renders editorial content from a per-tenant data directory mounted into its container at runtime, with no GitHub credentials or GHA runs in the editing path.

## Repos in this workspace

You operate from the orchestrator root (the directory holding this `CLAUDE.md`). Per-engagement site clones live as gitignored child dirs alongside it.

- `./` — this orchestrator. Holds CLAUDE.md, preflight.md, prompt.md, .claude/.
- `./site-<slug>/` — per-engagement working copy. Created by `gh repo clone`, modified locally, pushed back to `optidigi/site-<slug>` `main` at the sign-off gate. Persists on disk after the run for inspection.

## Subagents available

- `payload-seeder` — markdown + site-data → Payload pages, media, siteSettings via REST. Dispatch in Phase 4.
- `site-converter` — surgical SSR conversion of the cloned site. Dispatch in Phase 5.
- `cms-reviewer` — post-conversion audit. Dispatch in Phase 7.

See `.claude/agents/*.md` for input/output contracts.

## Hard rules

1. Read `preflight.md` first when starting a CMS-ification. Summarize back what you understood. Wait for user confirmation.
2. Then read `prompt.md` and run the 10-phase runbook.
3. Never modify any of the three sibling orchestrator repos (`sitegen-orchestrator`, `sitegen-template`, `sitegen-themes`). The cloned `./site-<slug>/` is yours to modify; nothing else in or above this working directory is.
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
- No bare property access on CMS reader results: `grep -rEn '(getPage|getSite)\([^)]*\)\.[a-zA-Z]' src/` returns zero hits (every access goes through `?.` or destructure-with-default)

## Re-engagements

If a CMS-ified site needs CMS-related changes weeks later (e.g., parallel workstream's schema changed), this orchestrator does NOT support a "patch existing CMS-ified site" mode. Operator must manually revert the site repo (`git reset --hard origin/main` after deleting local clone), delete the Payload tenant, then re-run `/add-cms <slug>`. The Phase 2 idempotency check enforces this.

If the operator asks you to "patch the existing CMS" or "incrementally update the CMS-ified site", refuse and walk them through the manual revert + re-run sequence above. Do not attempt destructive recovery (`git reset --hard`, tenant deletion) on your own — the operator runs those.

## Where the design lives

Full design spec: `docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md`. When in doubt about WHY something is done a particular way, that document is the source of truth.
```

- [ ] **Step 2: Verify file**

Run:
```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
wc -l CLAUDE.md && head -5 CLAUDE.md
```

Expected: ~50 lines, header reads "# sitegen-cms-orchestrator — Claude Code conventions".

- [ ] **Step 3: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with conventions and hard rules"
```

---

## Task 3: preflight.md (background context, read on demand)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/preflight.md`

**Why:** Background context the orchestrator reads at the start of every run. After reading, the orchestrator summarizes back understanding to the operator and waits for confirmation before reading `prompt.md`. Mirrors `sitegen-orchestrator/preflight.md` shape. Sections: purpose, deploy chain, standards, tool inventory, subagent inventory, repo conventions, anti-patterns.

- [ ] **Step 1: Write `preflight.md`**

Write the file with this content:

```markdown
# Preflight — read before adding CMS to a site

This document gives you the context you need to run the sitegen-cms workflow safely and well. After reading, summarize back to the user what you understood. **Do not open `prompt.md` until the user confirms.**

## Purpose

Take an existing static Astro landing-page site (built and deployed by `sitegen-orchestrator`, living at `optidigi/site-<slug>`) and transform it into a CMS-backed site driven by a self-hosted Payload v3 instance. After the run:

- A Payload tenant exists for this site.
- Editorial content (page text, media, brand info, NAP, socials) lives in Payload only — the markdown files in the site repo are deleted as part of the conversion.
- The site is Astro SSR (Node), reading per-tenant JSON from a mounted volume at request time.
- Editor changes in Payload are visible on next request — no GHA runs, no GitHub PATs, no webhook bridge.
- One editor account is created with email `admin@optidigi.nl` (operator updates to client email after end-to-end verification).

The operator runs the operational side (VPS compose update, container restart). Your scope ends at "operator confirmed editor can save in Payload and see the change on the live site".

## The deploy chain end-to-end

```
optidigi/site-<slug> (existing, static)
        │
        │ /add-cms <slug>
        ▼
this orchestrator clones it to ./site-<slug>/
        │
        ├─→ POST tenant + pages + media + siteSettings to Payload (cms.optidigi.nl)
        │       │
        │       │ Payload's afterChange hook writes per-tenant JSON to:
        │       │   /srv/data/saas/payload-siab/<tenantId>/{pages,site.json,media}/
        │       ▼
        │   (parallel workstream owns this hook + the disk layout)
        │
        └─→ converts ./site-<slug>/ from static to Astro SSR + Node runtime
                │
                │ commits to local main (NOT pushed yet)
                │
                │ operator approves sign-off gate
                ▼
        git push origin main → GHA publish.yml → ghcr.io/optidigi/site-<slug>:latest
                │
                │ operator updates VPS compose to add the volume mount + env vars,
                │ docker compose pull && up -d
                ▼
        site container reads /data/pages/<slug>.json on every request
        site container reads /data/site.json for site-wide data
        editor saves in Payload → JSON written to disk → next request sees fresh
```

## Standards (always on)

- **SEO baseline preserved.** The original site cleared the SEO floor (sitemap, robots.txt, llms.txt, JSON-LD Organization, security headers). Conversion preserves all of it. The reviewer enforces this.
- **Security headers** move from `nginx.conf` (deleted) to `src/middleware.ts` (created). Same headers, different location.
- **Defensive rendering everywhere.** Missing or malformed CMS data renders empty fields, 200 OK. Site never breaks because content is missing.
- **Lighthouse floor preserved.** Mobile perf ≥75, a11y ≥85, BP ≥85, SEO ≥95. SSR + filesystem read + cache headers passes this; we're not auditing again post-conversion (the audit happened during the original sitegen run), but the reviewer flags any obvious regression.
- **No GitHub credentials or GHA runs in the editing path.** Code changes still go through GHA on push (unchanged); content changes are filesystem-mediated and never touch GitHub.

## Tool inventory

- `gh` — authenticated on this device. Used for `gh repo clone`, `gh run watch`, `gh api`. Verify with `gh auth status`.
- `git` — used for clone, commit, push. Direct commits to `main` of the cloned site; push only at sign-off gate.
- `pnpm` — package manager for Astro builds. `pnpm install`, `pnpm build`.
- `node` ≥ 20. Required for the converted SSR site to build.
- `curl` — for Payload REST calls (tenant create, page seed, media upload, user invite, siteSettings).
- `python3` — for parsing `src/content/site.ts` (the orchestrator dumps it through a small node script or sed; either works).
- `jq` — convenient for reading Payload responses (optional but useful).
- MCPs: none required for v1. (`context7` available via plugin if you need library docs.)

## Subagents (dispatch via the Agent tool)

- **`payload-seeder`** — Phase 4. Input: site repo path, tenant ID, Payload URL + token, parsed siteSettings, page list. Output: posts every page (with media auto-migrated and markdown sliced into richText blocks per H2), posts siteSettings, returns a markdown report. Tools: `Read`, `Bash`. Hard rule: never modifies the site repo.

- **`site-converter`** — Phase 5. Input: site repo path, tenant ID, primary domain. Output: SSR conversion surgery (astro.config.mjs, package.json, Dockerfile, page routes, BaseLayout, SEO components, deletes content collection, adds src/lib/cms.ts + middleware + healthz + Blocks renderer). One git commit per logical group. Tools: `Read`, `Write`, `Edit`, `Bash`. Hard rule: never pushes; never modifies non-content components.

- **`cms-reviewer`** — Phase 7. Uses `code-reviewer` agent type as base, with sitegen-cms-specific context. Input: site repo path, intake summary, conversion report. Output: blocking + non-blocking findings. Tools: `Read`, `Bash`, `Grep`, `Glob`. Hard rule: never modifies the site.

See full contracts in `.claude/agents/*.md`.

## Repo locations & permissions

- Org: `optidigi`. The site repo already exists from the prior sitegen-orchestrator run.
- Image registry: `ghcr.io/optidigi/site-<slug>` — same as before. The new image (with SSR runtime) replaces `:latest` after sign-off push triggers GHA.
- Payload instance: at the URL in `.env`'s `PAYLOAD_API_URL` (operator-configured, typically `https://cms.optidigi.nl`).
- Per-tenant data dir on VPS: operator-supplied at intake (typically under `/srv/data/saas/payload-siab/<tenantId>/`).
- VPS-side `docker compose pull && up -d` plus the volume-mount edit are server-side. Don't SSH; you can help the user diagnose.

## Anti-patterns (don't do these)

- Don't push to `optidigi/site-<slug>` `main` until Phase 9 sign-off gate.
- Don't try to "re-run" `/add-cms` on an already-CMS-ified site. The Phase 2 idempotency check bails. Operator must manually revert (`git reset --hard origin/main`) and delete the Payload tenant first.
- Don't delete the Payload tenant on any kind of failure. Operator decides.
- Don't strip the SEO baseline files from `public/`. They're preserved through conversion.
- Don't try to migrate non-markdown-referenced images. Only images referenced inside `src/content/pages/*.md` get auto-migrated to Payload media. Hero backgrounds, logos baked into components, etc. stay in `src/assets/`.
- Don't include "Generated with Claude Code" footers in commits or anywhere else. The operator does not want them.
- Don't write Payload schema decisions. The parallel workstream owns the schema. If a POST 4xx-es with a schema mismatch error, escalate to the operator.

## When you're done reading

Tell the user, in your own words: (a) what the workflow does end-to-end, (b) what subagents are available and when each fires, (c) what the orchestrator never touches (the three sibling repos pre-run; the Payload tenant on failure; GitHub at content-edit time), and (d) where the per-tenant data lands and gets read from. Then ask permission to read `prompt.md` and start Phase 1.
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
wc -l preflight.md && grep -c "^##" preflight.md
```

Expected: ~100 lines, ~9 H2 sections.

- [ ] **Step 3: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add preflight.md
git commit -m "docs: add preflight.md with workflow background and tool inventory"
```

---

## Task 4: prompt.md (the 10-phase runbook)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/prompt.md`

**Why:** The runbook the orchestrator follows phase-by-phase after the user confirms preflight. Each phase has explicit GATE markers (hard stops), bash commands the orchestrator runs, expected outputs, and failure handling that points back to the spec's failure-handling table.

- [ ] **Step 1: Write `prompt.md`**

Write the file with this content:

```markdown
# Sitegen CMS runbook

You have read `preflight.md` and the user has confirmed your understanding. Follow this runbook phase-by-phase. Each **GATE** marker is a hard stop — do not proceed past it without the action specified.

The slash command was invoked as `/add-cms <slug>`. The slug is your primary identifier throughout.

---

## Phase 1 — Intake

Confirm `.env` in the orchestrator working dir contains the required keys:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
test -f .env && grep -q '^PAYLOAD_API_URL=' .env && grep -q '^PAYLOAD_API_TOKEN=' .env && echo OK
```

If not OK, bail with: "Missing PAYLOAD_API_URL or PAYLOAD_API_TOKEN in .env. Copy .env.example to .env and fill in your Payload instance URL + a Management API token."

Source the env:

```bash
set -a; source .env; set +a
```

Ping Payload:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' "${PAYLOAD_API_URL}/api/health" || \
  curl -fsS -o /dev/null -w '%{http_code}\n' "${PAYLOAD_API_URL}/admin/login"
```

Expected: `200`. If non-200 or unreachable, bail with the URL and error.

Ask the operator (one question at a time, accept "skip" to defer):

1. **VPS host path for this tenant's Payload data directory.** Convention: `/srv/data/saas/payload-siab/<tenantId>` (tenant ID is filled in after Phase 3, so accept either a complete path or a path with a `<tenantId>` placeholder).
2. **(Optional) Client editor email** for record-keeping. The actual Payload user is created with `admin@optidigi.nl` regardless. Operator updates the email in Payload admin after end-to-end verification.

Summarize the captured intake:

```
Intake summary
--------------
Slug:                  <slug>
Payload URL:           ${PAYLOAD_API_URL}
VPS data path:         <as supplied>
Client editor email:   <as supplied or "n/a">
```

**GATE:** "Approve to proceed to Phase 2 (clone & inspect)?"

---

## Phase 2 — Clone & inspect

Verify the orchestrator working dir doesn't already have `./site-<slug>/`:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
test ! -e site-<slug> || { echo "FATAL: ./site-<slug>/ already exists. Remove it or work in a different orchestrator clone."; exit 1; }
```

Clone:

```bash
gh repo clone optidigi/site-<slug> ./site-<slug>
cd ./site-<slug>
```

If `gh repo clone` fails: bail. Likely auth or repo doesn't exist. Operator handles.

Verify conventions:

```bash
test -f src/content/site.ts || { echo "FATAL: src/content/site.ts missing"; exit 1; }
test -d src/content/pages || { echo "FATAL: src/content/pages/ missing"; exit 1; }
test -f astro.config.mjs || { echo "FATAL: astro.config.mjs missing"; exit 1; }
ls src/content/pages/*.md | head -1 || { echo "FATAL: no markdown pages"; exit 1; }
grep -q "output: 'static'" astro.config.mjs || grep -q 'output: "static"' astro.config.mjs || \
  echo "WARN: astro.config.mjs may not declare output: 'static' — confirm before continuing"
grep -q '"astro": "\^6' package.json || echo "WARN: site is not on Astro 6 — converter targets Astro 6"
```

Idempotency check — bail if any of these are true (site is already CMS-ified):

```bash
test -e src/lib/cms.ts && { echo "FATAL: site appears already CMS-ified (src/lib/cms.ts exists)"; exit 1; }
test -e docker-compose.cms.yml.example && { echo "FATAL: site appears already CMS-ified (docker-compose.cms.yml.example exists)"; exit 1; }
grep -qE "output:\s*['\"]server['\"]" astro.config.mjs && { echo "FATAL: astro.config.mjs already has SSR output"; exit 1; }
```

If any idempotency check fires: print the diagnostic, advise the operator to manually revert the site (`git reset --hard origin/main` after deleting the local clone) AND delete the Payload tenant if one exists, then re-run.

Parse `src/content/site.ts` into JSON for downstream phases (Phase 4 dispatch, Phase 9 compose snippet). Use `tsx` via `pnpm dlx` so we don't depend on the cloned site already having `tsx` installed:

```bash
# Still in ./site-<slug>/ from the cd above
pnpm dlx tsx --eval "
  import { site } from './src/content/site';
  process.stdout.write(JSON.stringify(site, null, 2));
" > /tmp/site.json

# Sanity-check: brand and primaryDomain must be present
jq -e '.brand and .primaryDomain' /tmp/site.json >/dev/null || { echo "FATAL: parsed site.ts missing required fields"; cat /tmp/site.json; exit 1; }
```

`/tmp/site.json` is the canonical parsed siteSettings for the rest of the run. Read brand / language / primaryDomain / aliases / NAP presence / socials / nav out of it via `jq` for the operator summary.

Walk `src/content/pages/` to enumerate pages — for each `*.md`, read the frontmatter `title` / `role` / `order` / `slug` (filename without `.md`).

Show the operator:

```
Detected site
-------------
Brand:           <site.brand>
Language:        <site.language>
Primary domain:  <site.primaryDomain>
Aliases:         <site.aliases>
NAP:             <set | not set>
Socials:         <list keys present>
Pages (N):
  - / (home, order 0)         from src/content/pages/index.md
  - /about (about, order 1)   from src/content/pages/about.md
  - ...
```

**GATE:** "Detected site matches expectations? Approve to proceed to Phase 3 (provision tenant)?"

---

## Phase 3 — Provision tenant

Build the request body via `jq -n` so brand/domain values containing quotes or shell metacharacters can't break the JSON or get expanded:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
set -a; source .env; set +a

PAYLOAD=$(jq -n \
  --arg slug   "<slug>" \
  --arg name   "<brand from Phase 2>" \
  --arg domain "<primaryDomain from Phase 2>" \
  '{slug:$slug, name:$name, primaryDomain:$domain}')

curl -fsS -X POST "${PAYLOAD_API_URL}/api/tenants" \
  -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" > /tmp/tenant-create.json

TENANT_ID=$(jq -r '.doc.id // .id' /tmp/tenant-create.json)
echo "Tenant created: ${TENANT_ID}"
```

`TENANT_ID` is now the canonical reference for the rest of the run. Substitute it for every `<tenantId>` placeholder in Phases 4, 8, 9 (compose snippet), and 10. The full create response also persists in `/tmp/tenant-create.json` for re-reads.

If the response indicates "tenant already exists" (4xx with that hint), bail per idempotency rules.

If the operator's intake had a `<tenantId>` placeholder in the VPS data path, replace it now and confirm the resolved path back:

```
Resolved VPS data path: /srv/data/saas/payload-siab/<tenantId>
```

---

## Phase 4 — Seed content

Dispatch the `payload-seeder` subagent. The dispatch prompt must include:

- Absolute site repo path: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/site-<slug>`
- Tenant ID (`${TENANT_ID}` from Phase 3)
- `PAYLOAD_API_URL` and `PAYLOAD_API_TOKEN` values
- The parsed siteSettings JSON — read `/tmp/site.json` produced in Phase 2 and embed it (or paste as a JSON blob in the dispatch prompt)
- The list of `src/content/pages/*.md` paths

Wait for the subagent's report. Verify in Payload admin (orchestrator prints a clickable link):

```
Payload admin: ${PAYLOAD_API_URL}/admin/collections/pages?where[tenant][equals]=<tenantId>
```

If the subagent reports failures: stop the run, surface them to the operator, advise manual cleanup in Payload admin before re-running.

---

## Phase 5 — Convert site

Dispatch the `site-converter` subagent. The dispatch prompt must include:

- Absolute site repo path
- Tenant ID
- Primary domain

Wait for the subagent's report. It will have made multiple commits on local `main`. Verify with:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator/site-<slug>
git log --oneline -10
```

Expected: ~7 commits with `chore:`, `feat:`, `refactor:` prefixes per the spec's commit list.

If the subagent bailed mid-conversion: surface the report, advise operator to manually revert (`git reset --hard origin/main`) before re-running.

---

## Phase 6 — Build verify

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator/site-<slug>
pnpm install
pnpm build
```

Expected: `pnpm build` exits 0, with `dist/server/` produced.

If the build fails: inspect the error. Common causes:
- Missing import in a converted file → fix and re-run
- Type mismatch in `src/lib/types.ts` vs use site → fix and re-run
- Adapter not installed → re-run `pnpm install`

Max 2 fix attempts. After 2 failures, escalate with the build log.

---

## Phase 7 — Review

Dispatch the `cms-reviewer` subagent. Dispatch prompt includes:

- Absolute site repo path
- Captured intake summary (from Phase 1 + Phase 2)
- The conversion report from `site-converter` (Phase 5)

Wait for the review. If `Status: clean`, proceed. If blocking findings, address them (re-edit files, re-run `pnpm build`), re-dispatch reviewer. **Max 2 loops.**

After 2 unsuccessful loops, escalate to the operator with the latest review and current state.

---

## Phase 8 — Invite editor

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
set -a; source .env; set +a

# Generate a random password (never logged or surfaced)
PW=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)

# Build the request body via jq -n so the random password (which may contain
# shell metacharacters from base64) and the tenant ID flow through safely.
USER_BODY=$(jq -n \
  --arg email "admin@optidigi.nl" \
  --arg pw    "${PW}" \
  --arg tid   "${TENANT_ID}" \
  --arg role  "editor" \
  '{email:$email, password:$pw, tenant:$tid, role:$role}')

# Create the user (the API field for tenant linkage may vary per parallel workstream's
# schema; default assumption: a single 'tenant' field with the tenant ID).
curl -fsS -X POST "${PAYLOAD_API_URL}/api/users" \
  -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${USER_BODY}"

# Scrub the password immediately after the only command that referenced it.
unset PW USER_BODY

# Trigger forgot-password so an email goes out regardless of auth.verify config.
# The forgot-password call is idempotent and safe even if verify already sent one.
curl -fsS -X POST "${PAYLOAD_API_URL}/api/users/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@optidigi.nl"}'
```

If user create returns 4xx with a schema mismatch (e.g., the parallel workstream uses `tenants: [<id>]` array, or a different role enum): surface the response, escalate. Do not retry blindly.

---

## Phase 9 — Sign-off + push

Print to operator:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator/site-<slug>
git log --oneline origin/main..HEAD
git diff origin/main..HEAD --stat
```

Print the compose snippet (substitute the actual values):

```
Drop-in snippet — add to your VPS compose for this site:

  services:
    site-<slug>:
      image: ghcr.io/optidigi/site-<slug>:latest
      restart: unless-stopped
      volumes:
        - <vps-data-path-from-intake>:/data:ro
      environment:
        CMS_DATA_DIR: /data
        CMS_TENANT_ID: <tenantId>
        SITE_URL: https://<primaryDomain>
```

Print the editor reminder:

```
Editor invitation went to admin@optidigi.nl. Verify everything works end-to-end
in Phase 10. When you're ready to hand off to the client, update the user's
email in Payload admin to <client editor email from intake, or "the client's address">.
```

Print the Payload admin link:

```
Payload admin: ${PAYLOAD_API_URL}/admin/collections/pages?where[tenant][equals]=<tenantId>
```

**GATE:** "Approve to push to optidigi/site-<slug>:main? (Triggers GHA build of new image.)"

On approval:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator/site-<slug>
git push origin main

# Capture the new HEAD sha so we watch the right run, not "the most recent
# of any run on the repo". GHA registers the run a few seconds after push,
# so poll briefly.
SHA=$(git rev-parse HEAD)
RUN_ID=""
for i in $(seq 1 15); do
  RUN_ID=$(gh run list --commit "$SHA" --limit 1 --json databaseId -q '.[0].databaseId')
  [ -n "$RUN_ID" ] && break
  sleep 2
done
[ -z "$RUN_ID" ] && { echo "FATAL: no GHA run for $SHA after 30s"; exit 1; }

gh run watch "$RUN_ID" --exit-status
```

If push fails (likely auth): surface and stop. Do NOT force-push.
If GHA fails: tail logs, diagnose. Code issue → fix and push again. Infra issue → escalate with exact error.

Confirm the new image landed:

```bash
gh api "/orgs/optidigi/packages/container/site-<slug>/versions" | jq -r '.[0:3] | .[] | "\(.created_at) \(.metadata.container.tags[]?)"'
```

Expected: a recent `latest` tag (and a `sha-<short>` tag matching the new HEAD commit).

---

## Phase 10 — Verify end-to-end

Walk the operator through:

1. **Update VPS compose.** Paste the snippet from Phase 9 into the VPS docker-compose file for this site. Run `docker compose pull && docker compose up -d` for the site service.

2. **Hit the live site.** `curl -sI https://<primaryDomain>` should return 200. Open in a browser; pages render with the seeded content.

3. **Edit a field in Payload admin.** Operator clicks the "set password" link from the email at `admin@optidigi.nl`, sets a password, logs in, navigates to Pages → home, edits the H1 heading or another visible text, saves.

4. **Hard-refresh the live site.** Confirm the change is visible.

**GATE:** "Round-trip works end-to-end?"

If any step fails, diagnose:

- `/data/pages/index.json` exists and is fresh on VPS? (Operator runs `cat`, `stat`.)
- Site container healthcheck passing? (`docker ps` for the site service shows healthy.)
- Site `/healthz` returns 200? (`curl -sI https://<primaryDomain>/healthz`)
- Site logs show errors? (`docker logs site-<slug>`.)

Common failure modes:
- Volume not mounted → operator's compose missed the `volumes:` block.
- Wrong `CMS_TENANT_ID` → operator typo.
- Payload's afterChange not configured to write to the same path → parallel workstream issue, escalate.

When the round-trip works, confirm to the operator:

```
Done.

CMS-ified site: optidigi/site-<slug>
Image:          ghcr.io/optidigi/site-<slug>:latest (new SSR runtime)
Tenant:         <tenantId> on ${PAYLOAD_API_URL}
Editor:         admin@optidigi.nl (update to client email when ready to hand off)
Local clone:    ./site-<slug>/ (kept for inspection; remove manually when done)
```

Done.
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
wc -l prompt.md && grep -c "^## Phase" prompt.md && grep -c "GATE" prompt.md
```

Expected: ~250 lines, 10 phases, ≥4 GATEs.

- [ ] **Step 3: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add prompt.md
git commit -m "docs: add prompt.md with 10-phase runbook"
```

---

## Task 5: .claude/settings.json (permissions)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/settings.json`

**Why:** Permissions allowlist for the bash commands the runbook executes. Mirrors `sitegen-orchestrator/.claude/settings.json` shape — `allow` for safe ops, `deny` for destructive global ops, `ask` for remote operations and recoverable destructive ops.

- [ ] **Step 1: Create directory**

```bash
mkdir -p /home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude
```

- [ ] **Step 2: Write `settings.json`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm install)",
      "Bash(pnpm install --frozen-lockfile)",
      "Bash(pnpm add:*)",
      "Bash(pnpm build)",
      "Bash(pnpm astro check)",
      "Bash(pnpm astro:*)",
      "Bash(node --version)",
      "Bash(node:*)",
      "Bash(corepack:*)",
      "Bash(curl -fsS:*)",
      "Bash(curl -fsSL:*)",
      "Bash(curl -sI:*)",
      "Bash(curl -s:*)",
      "Bash(curl -I:*)",
      "Bash(curl -X POST:*)",
      "Bash(curl -X PATCH:*)",
      "Bash(curl -X DELETE:*)",
      "Bash(jq:*)",
      "Bash(gh auth status)",
      "Bash(gh repo view:*)",
      "Bash(gh repo list:*)",
      "Bash(gh repo clone:*)",
      "Bash(gh run watch:*)",
      "Bash(gh run list:*)",
      "Bash(gh run view:*)",
      "Bash(gh api:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git init:*)",
      "Bash(git branch:*)",
      "Bash(git checkout:*)",
      "Bash(git remote:*)",
      "Bash(git rev-parse:*)",
      "Bash(mkdir -p:*)",
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(grep:*)",
      "Bash(rg:*)",
      "Bash(find:*)",
      "Bash(test:*)",
      "Bash(wc:*)",
      "Bash(stat:*)",
      "Bash(python3:*)",
      "Bash(base64:*)",
      "Bash(seq:*)",
      "Bash(sleep:*)",
      "Bash(tr:*)"
    ],
    "deny": [
      "Bash(rm -rf /:*)",
      "Bash(rm -rf ~:*)",
      "Bash(rm -rf ~/:*)",
      "Bash(rm -rf $HOME:*)",
      "Bash(git push --force:*)",
      "Bash(git push -f:*)"
    ],
    "ask": [
      "Bash(rm -rf:*)",
      "Bash(git push:*)",
      "Bash(git reset --hard:*)",
      "Bash(gh repo create:*)",
      "Bash(gh repo delete:*)"
    ]
  }
}
```

- [ ] **Step 3: Verify JSON is valid**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
python3 -c 'import json; json.load(open(".claude/settings.json"))' && echo "settings.json OK"
```

Expected: "settings.json OK".

- [ ] **Step 4: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add .claude/settings.json
git commit -m "chore: add .claude settings with permissions allowlist"
```

---

## Task 6: .claude/commands/add-cms.md (slash command)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/commands/add-cms.md`

**Why:** Defines the `/add-cms <slug>` slash command. Reads preflight, awaits operator confirmation, then reads prompt.md and starts Phase 1 with the slug already known.

- [ ] **Step 1: Create directory**

```bash
mkdir -p /home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/commands
```

- [ ] **Step 2: Write `add-cms.md`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/commands/add-cms.md`:

```markdown
---
description: Add Payload CMS to an existing site-<slug> repo (reads preflight.md, awaits confirm, then prompt.md)
argument-hint: <slug>
---

Add Payload CMS to an existing `optidigi/site-<slug>` repo.

The site slug was passed as: `$ARGUMENTS`

If `$ARGUMENTS` is empty, stop and ask me for the slug before doing anything else. Do not read preflight.md until you have a slug.

1. Read `preflight.md` in the current working directory.
2. Summarize back to me, in your own words: what the workflow does end-to-end, what subagents are available and when each fires, what the orchestrator never touches, and where per-tenant data lives and gets read from.
3. Wait for me to explicitly confirm your understanding.
4. Once I confirm, read `prompt.md` and begin Phase 1 (Intake) with the slug `$ARGUMENTS` already known.

Do not skip the confirmation gate.
```

- [ ] **Step 3: Verify**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
test -f .claude/commands/add-cms.md && head -3 .claude/commands/add-cms.md
```

Expected: file exists, frontmatter starts with `---` and `description:`.

- [ ] **Step 4: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add .claude/commands/add-cms.md
git commit -m "feat: add /add-cms slash command"
```

---

## Task 7: .claude/agents/payload-seeder.md (subagent spec)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents/payload-seeder.md`

**Why:** Subagent contract for Phase 4. Reads markdown + parsed siteSettings, uploads images to Payload media, slices markdown into richText blocks per H2, POSTs each page + the siteSettings singleton. Returns a markdown report.

- [ ] **Step 1: Create directory**

```bash
mkdir -p /home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents
```

- [ ] **Step 2: Write `payload-seeder.md`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents/payload-seeder.md`:

```markdown
---
name: payload-seeder
description: Use during Phase 4 of the sitegen-cms runbook. Uploads images to Payload media, transforms markdown pages into Payload pages collection entries (one richText block per H2), and posts the siteSettings singleton. Returns a markdown report. Does not modify the site repo.
tools: Read, Bash, Grep
---

You are a focused subagent within the sitegen-cms workflow. You seed a Payload v3 tenant with all editorial content from a site repo, then return a report. You do not modify the site repo.

## Inputs (provided in your dispatch prompt)

- **Absolute path to** the site repo (e.g. `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/site-amicare`).
- **Tenant ID** (from Phase 3).
- **`PAYLOAD_API_URL`** and **`PAYLOAD_API_TOKEN`** values.
- **`siteSettings` JSON** — the parsed contents of the site's `src/content/site.ts`. Required: `brand`, `language`, `primaryDomain`, `aliases`, `socials`, `nav`. Optional: `description`, `nap`, `hours`, `serviceArea`. Either inlined in the dispatch prompt or as a path (e.g. `/tmp/site.json`) — if you receive a path, read the file.
- **List of markdown page paths** under `src/content/pages/`. v1 only supports top-level pages (no recursion into subdirectories).

## Critical: build all JSON via `jq -n --arg`, never via string interpolation

Page titles, descriptions, brand names and other operator-supplied strings can contain `"`, `'`, `$`, backticks, and other shell or JSON metacharacters. Building POST bodies by interpolating these into a quoted heredoc or `-d '...'` literal will silently produce malformed JSON or expose the content to shell evaluation.

Use this pattern for every Payload POST in this subagent:

```bash
BODY=$(jq -n \
  --arg key1 "${value1}" \
  --arg key2 "${value2}" \
  '{key1:$key1, key2:$key2}')
curl -fsS -X POST "${PAYLOAD_API_URL}/api/<collection>" \
  -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${BODY}"
```

For nested objects / arrays use `--argjson` (parses the value as JSON, not a string):

```bash
BODY=$(jq -n \
  --arg slug "$SLUG" \
  --argjson keywords "$(printf '%s' "$KEYWORDS_JSON")" \
  --argjson blocks "$(printf '%s' "$BLOCKS_JSON")" \
  '{slug:$slug, keywords:$keywords, blocks:$blocks}')
```

The `prompt.md` runbook's Phase 3 (tenant create) and Phase 8 (user create) follow this same pattern — match it.

## What to do

For each markdown page:

1. Read the file. Parse YAML frontmatter (between the first two `---` lines) and the markdown body (everything after).

2. Strip the leading `# <title>` line from the body if present — the page title is rendered by the layout from the frontmatter; including it in a block body would duplicate it on the page.

3. Scan the body for image references. Recognize all of these forms:

   - **Inline markdown image:** `![alt](path)` (single quotes, double quotes, or no quotes around the path)
   - **Reference-style markdown image:** `![alt][ref]` plus a separate `[ref]: <path>` definition (resolve `<path>` from the matching definition in the same file)
   - **HTML img tag:** `<img src="path">` or `<img src='path'>` (also catch `srcset` attribute candidates)
   - **Astro Image / Picture:** `<Image src="..." />`, `<Picture src="..." />` (single or double quoted)

   Do NOT treat plain link syntax `[label](path)` (no leading `!`) as an image embed — it's a link to a file, leave it alone.

   For each unique image reference found, perform path resolution + upload (steps 3a–3d).

   3a. **Resolve the path** to an absolute filesystem path under the site repo:

       | Path in markdown | Resolves to |
       |---|---|
       | starts with `/` (e.g. `/src/assets/x.jpg`) | `<repo>/src/assets/x.jpg` (treat as repo-root-relative) |
       | starts with `./` (e.g. `./hero.jpg`) | relative to the markdown file's directory |
       | bare path (e.g. `hero.jpg` or `assets/hero.jpg`) | try `<repo>/<path>`, then `<repo>/public/<path>`, then `<repo>/src/<path>` (first one that exists wins) |
       | starts with `http://` or `https://` | external — skip with TODO comment, do not upload |
       | starts with `/home/`, `~/`, or any absolute path outside the repo | out-of-repo — skip with TODO comment, do not upload |

   3b. **Verify the file exists** (`test -f <resolved-path>`). If not, skip with TODO comment in the body and note in report. Do not let `curl -F file=@...` produce an opaque "file not found" error.

   3c. **Upload to Payload media:**

       ```bash
       RESP=$(curl -fsS -X POST "${PAYLOAD_API_URL}/api/media" \
         -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
         -F "tenant=${TENANT_ID}" \
         -F "file=@${RESOLVED_PATH}")
       MEDIA_URL=$(echo "$RESP" | jq -r '.doc.url // .url')
       ```

   3d. **Rewrite the body's reference** to point at `$MEDIA_URL`. For reference-style markdown, also remove the now-orphaned `[ref]: <path>` definition.

   If upload fails for one image: continue with the page; replace its reference in the body with `<!-- TODO: upload <filename> in Payload admin -->`. Note in your report.

4. Split the rewritten body into richText blocks on H2 boundaries (lines starting with `## `). Each block has the shape:

   ```json
   {
     "blockType": "richText",
     "heading": "<H2 text without the leading '## '>",
     "body": "<markdown of section excluding the H2 line>"
   }
   ```

   Edge cases:
   - **Content before the first H2** (intro paragraphs after the H1): wrap in a leading block with `heading: ""` and the body as the markdown of that pre-H2 section.
   - **No H2s at all** (page is just an H1 + body): produce a single block with `heading: ""` and the entire post-H1 body.

5. POST the page using the `jq -n` pattern (NOT a `-d '{ ... }'` literal):

   ```bash
   PAGE_BODY=$(jq -n \
     --arg tid "${TENANT_ID}" \
     --arg slug "${SLUG}" \
     --arg title "${TITLE}" \
     --arg desc "${DESCRIPTION}" \
     --argjson keywords "${KEYWORDS_JSON_ARRAY}" \
     --arg ogImage "${OG_IMAGE:-}" \
     --arg role "${ROLE}" \
     --argjson order "${ORDER}" \
     --argjson blocks "${BLOCKS_JSON_ARRAY}" \
     '{tenant:$tid, slug:$slug, title:$title, description:$desc, keywords:$keywords, ogImage:($ogImage|select(length>0)), role:$role, order:$order, blocks:$blocks}')

   curl -fsS -X POST "${PAYLOAD_API_URL}/api/pages" \
     -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
     -H "Content-Type: application/json" \
     -d "${PAGE_BODY}"
   ```

   `<slug>` for `index.md` is `index`; for `about.md` is `about`; etc. (Filename without `.md`.)

   Do NOT send `id` or `updatedAt` — both are server-assigned.

After all pages, POST siteSettings with the same `jq -n` pattern, including only the keys present in the input:

```bash
SITE_BODY=$(jq -n \
  --arg tid "${TENANT_ID}" \
  --arg brand "${BRAND}" \
  --arg lang "${LANGUAGE}" \
  --arg domain "${PRIMARY_DOMAIN}" \
  --argjson aliases "${ALIASES_JSON_ARRAY}" \
  --argjson socials "${SOCIALS_JSON_OBJECT}" \
  --argjson nav "${NAV_JSON_ARRAY}" \
  '{tenant:$tid, brand:$brand, language:$lang, primaryDomain:$domain, aliases:$aliases, socials:$socials, nav:$nav}')

# Conditionally fold in the optional fields if present in the input siteSettings JSON:
[ -n "${DESCRIPTION:-}" ] && SITE_BODY=$(echo "$SITE_BODY" | jq --arg d "$DESCRIPTION" '. + {description:$d}')
[ -n "${NAP_JSON:-}" ]     && SITE_BODY=$(echo "$SITE_BODY" | jq --argjson n "$NAP_JSON" '. + {nap:$n}')
[ -n "${HOURS_JSON:-}" ]   && SITE_BODY=$(echo "$SITE_BODY" | jq --argjson h "$HOURS_JSON" '. + {hours:$h}')
[ -n "${SERVICE_AREA_JSON:-}" ] && SITE_BODY=$(echo "$SITE_BODY" | jq --argjson s "$SERVICE_AREA_JSON" '. + {serviceArea:$s}')

curl -fsS -X POST "${PAYLOAD_API_URL}/api/siteSettings" \
  -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${SITE_BODY}"
```

Do NOT send `id` or `updatedAt` — both are server-assigned.

## Body format note

The Payload `pages` collection's `body` field shape depends on the parallel workstream's choice. Default assumption: it's a Lexical JSON tree, and Payload's REST endpoint accepts markdown directly via the `@payloadcms/richtext-lexical` markdown adapter wrapped in your POST body. If the parallel workstream's collection rejects markdown (returns 4xx with schema mismatch), do NOT retry blindly. Stop and report — the orchestrator will escalate the schema contract.

If the parallel workstream documented a different POST shape (e.g., `body` as a plain HTML string, or as raw Lexical JSON), follow that instead. The contract is THEIRS; you adapt.

## Output contract

Return a markdown report:

```markdown
# Seed report — tenant <id>

## Pages created
- /  (home, role=home, order=0) → page id <pid>, <N> blocks, <M> images migrated
- /about (about, role=about, order=1) → page id <pid>, <N> blocks, <M> images migrated
- ...

## Media uploaded
- src/assets/hero.jpg → /api/media/<id> → /data/media/hero-<hash>.jpg
- src/assets/team.png → ...
- ...

## Site settings
- siteSettings created (id <sid>) with brand, language, primaryDomain, NAP, socials.

## Failures
- (none) | <list of failures with cause>
```

If the report has any failures, end with: `**Status: failures encountered — orchestrator should stop the run.**`
Otherwise: `**Status: clean — proceed to Phase 5 (convert).**`

## Hard rules

- **Never modify any file in the site repo.** Read-only.
- On any failure mid-stream, stop and report. Do not attempt rollback (orchestrator handles via Phase 2 idempotency on next run).
- Do not surface the `PAYLOAD_API_TOKEN` value in your report.
- Image upload failures: skip the image, replace ref with TODO comment, continue with the page. Do not skip the page.
- Page POST failures: stop. Surface the error response.
- siteSettings POST failure: stop. Surface the error response.
```

- [ ] **Step 3: Verify**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
head -5 .claude/agents/payload-seeder.md && wc -l .claude/agents/payload-seeder.md
```

Expected: YAML frontmatter at top, ~110 lines.

- [ ] **Step 4: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add .claude/agents/payload-seeder.md
git commit -m "feat: add payload-seeder subagent spec"
```

---

## Task 8: .claude/agents/site-converter.md (subagent spec)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents/site-converter.md`

**Why:** Subagent contract for Phase 5. Performs SSR conversion surgery on the cloned site, commit by logical group. The most file-heavy subagent — needs explicit per-file change guidance and block-by-block code samples.

- [ ] **Step 1: Write `site-converter.md`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents/site-converter.md`:

```markdown
---
name: site-converter
description: Use during Phase 5 of the sitegen-cms runbook. Performs surgical conversion of a cloned static Astro site into an SSR site that reads CMS content from a mounted volume. Commits each logical group as its own commit. Returns a conversion report.
tools: Read, Write, Edit, Bash, Glob
---

You are a focused subagent within the sitegen-cms workflow. You convert one cloned site repo from static Astro to Astro SSR (Node, reading per-tenant JSON from a mounted volume). You commit each logical group of changes as its own commit on local `main`. You do NOT push.

## Inputs (provided in your dispatch prompt)

- **Absolute path to** the cloned site repo.
- **Tenant ID**.
- **Primary domain** (for the compose example file).

## Conversion sequence

Perform these groups in order. After each group, run the listed verification, then commit. Use `git add` with explicit paths (never `git add .`).

---

### Group 1 — Install adapter and switch to SSR output

**Read `astro.config.mjs` first.** The minimum required deltas are:

1. Add `import node from '@astrojs/node';` (alongside the existing imports).
2. Set `output: 'server'` (replacing whatever's there, typically `'static'`).
3. Set `adapter: node({ mode: 'standalone' })` (add the property to the `defineConfig` argument).

**Use `Edit` for these three changes**, preserving every other line of the file. The cloned site may have integrations, vite config, redirects, image config, or other properties beyond what `sitegen-template` ships — none of those should be touched.

Reference target shape (sitegen-template's defaults plus the SSR additions — yours may have more):

```javascript
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

const SITE_URL = process.env.SITE_URL ?? 'https://example.com';

export default defineConfig({
  site: SITE_URL,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
```

Only fall back to wholesale `Write` (with the template above) if the existing file has none of the expected `defineConfig` properties (genuinely empty or broken). If the existing file has integrations or vite config beyond what the template above shows, **preserve them** and bail with a diagnostic listing the unfamiliar entries — let the operator confirm they're CMS-safe before proceeding.

Modify `package.json` — add `@astrojs/node` to dependencies and a `start` script:

```bash
cd <site-repo>
pnpm add @astrojs/node
```

Then verify the `start` script in `package.json`:

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "start": "node ./dist/server/entry.mjs"
  }
}
```

If the `start` script is missing, add it via `Edit`.

Verify: `cat astro.config.mjs | grep -E "output:|adapter:" ` shows `output: 'server'` and `adapter: node`.

Commit:
```bash
git add astro.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: install @astrojs/node and switch to SSR output"
```

---

### Group 2 — Add CMS reader, types, middleware

Create `src/lib/types.ts`:

```typescript
export type RichTextBlock = {
  blockType: 'richText';
  heading?: string;
  body: string;  // pre-serialized HTML from Payload's afterChange
};

export type Block = RichTextBlock;

export type Page = {
  id: string;
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  ogImage?: string;
  role: 'home' | 'about' | 'services' | 'contact' | 'page';
  order: number;
  blocks: Block[];
  updatedAt: string;
};

export type NAP = {
  legalName: string;
  displayName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
};

export type OpeningHours = {
  dayOfWeek: 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su';
  opens: string;
  closes: string;
};

export type SiteSettings = {
  brand: string;
  language: string;
  primaryDomain: string;
  aliases: string[];
  description: string;
  nap?: NAP;
  hours?: OpeningHours[];
  serviceArea?: string[];
  socials: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
    x?: string;
  };
  nav: { label: string; href: string }[];
  updatedAt: string;
};
```

Create `src/lib/cms.ts`:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page, SiteSettings } from './types';

const DATA_DIR = process.env.CMS_DATA_DIR ?? '/data';

async function readJson<T>(rel: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(DATA_DIR, rel), 'utf8');
  } catch (err: any) {
    // ENOENT (file missing) is the expected "no content yet" path — silent.
    // Any other read error is unexpected — log so operators can debug.
    if (err?.code !== 'ENOENT') {
      console.warn(`[cms] read failed for ${rel}:`, err?.message ?? err);
    }
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err: any) {
    // Corrupt JSON would otherwise vanish silently (page renders empty).
    // Loud here so operators see "Payload wrote garbage" vs "no content".
    console.error(`[cms] JSON parse failed for ${rel}:`, err?.message ?? err);
    return null;
  }
}

export async function getPage(slug: string): Promise<Page | null> {
  return readJson<Page>(`pages/${slug}.json`);
}

export async function getSite(): Promise<SiteSettings | null> {
  return readJson<SiteSettings>('site.json');
}

export function mediaPath(file: string): string {
  return path.join(DATA_DIR, 'media', file);
}
```

Create `src/middleware.ts`:

```typescript
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_ctx, next) => {
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  return response;
});
```

Note: if the cloned site's `nginx.conf` had a different / stricter CSP, copy that value into the middleware before deleting the nginx config in Group 5. Read `nginx.conf` first via `Read`, port any custom header values into `src/middleware.ts`.

Create `src/pages/healthz.ts`:

```typescript
import type { APIRoute } from 'astro';

export const GET: APIRoute = () => new Response('ok', { status: 200 });
```

Create `src/pages/media/[...path].ts`:

```typescript
import type { APIRoute } from 'astro';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.CMS_DATA_DIR ?? '/data';
const MEDIA_DIR = path.join(DATA_DIR, 'media');

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

export const GET: APIRoute = async ({ params }) => {
  const rel = (params.path ?? '').replace(/^\/+/, '');
  const full = path.resolve(MEDIA_DIR, rel);
  if (!full.startsWith(MEDIA_DIR + path.sep) && full !== MEDIA_DIR) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    const data = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
};
```

Create `src/components/cms/Blocks.astro`:

```astro
---
import RichText from './RichText.astro';
import type { Block } from '../../lib/types';

interface Props {
  blocks?: Block[] | null;
}

const { blocks } = Astro.props;
const list = blocks ?? [];
---

{list.map((block) => {
  if (block.blockType === 'richText') {
    return <RichText heading={block.heading} body={block.body} />;
  }
  // Unknown blockType — log so operators see when Payload introduces a
  // type the SSR site hasn't been redeployed to handle. Render nothing
  // (defensive) instead of throwing.
  console.warn(`[cms/Blocks] unknown blockType: ${(block as any).blockType}`);
  return null;
})}
```

Create `src/components/cms/RichText.astro`:

```astro
---
interface Props {
  heading?: string;
  body?: string;
}
const { heading, body } = Astro.props;
---

<section class="cms-block cms-block--richtext">
  {heading ? <h2>{heading}</h2> : null}
  {body ? <div set:html={body} /> : null}
</section>
```

Verify all files compile in TS-aware projects via `pnpm astro check` if available; otherwise just `ls` to confirm presence:

```bash
ls src/lib/cms.ts src/lib/types.ts src/middleware.ts src/pages/healthz.ts src/pages/media/[...path].ts src/components/cms/Blocks.astro src/components/cms/RichText.astro
```

Commit:
```bash
git add src/lib/ src/middleware.ts src/pages/healthz.ts src/pages/media/ src/components/cms/
git commit -m "feat: add cms reader, types, middleware, healthz, media route, blocks renderer"
```

---

### Group 3 — Rewrite page routes to use CMS reader

A **content-driven page** is any `.astro` file under `src/pages/` (including subdirectories) that imports from `astro:content` or calls `getEntry`/`getCollection`. That is the operational definition — anything else is left alone.

Find them with `Glob` first (covers subdirectories that the bash glob misses):

```bash
# Glob: src/pages/**/*.astro — then for each, Read to check for astro:content
# Bash equivalent (top-level only) for sanity:
grep -lI "getEntry\|getCollection\|astro:content" src/pages/*.astro 2>/dev/null
```

For each content-driven page, modify ONLY the import section and the data-flow lines (the `getEntry`/`render`/`Content` calls). **Use `Edit`, not `Write`.** Preserve any other markup the page contains — hand-written sections, custom components, theme widgets, contact-form embeds. Only the editorial-data plumbing changes.

Example for `src/pages/index.astro`:

Before:
```astro
---
import { getEntry, render } from 'astro:content';
import BaseLayout from '../layouts/BaseLayout.astro';

const home = await getEntry('pages', 'index');
if (!home) {
  throw new Error('Missing required content entry: pages/index');
}
const { Content } = await render(home);
---

<BaseLayout
  title={home.data.title}
  description={home.data.description}
  ogImage={home.data.ogImage}
>
  <main class="prose mx-auto max-w-3xl px-4 py-16">
    <Content />
  </main>
</BaseLayout>
```

After:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import Blocks from '../components/cms/Blocks.astro';
import { getPage } from '../lib/cms';

const page = await getPage('index');
---

<BaseLayout
  title={page?.title ?? ''}
  description={page?.description ?? ''}
  ogImage={page?.ogImage}
>
  <main class="prose mx-auto max-w-3xl px-4 py-16">
    <Blocks blocks={page?.blocks} />
  </main>
</BaseLayout>
```

Apply analogous transformations to all other content-driven `.astro` pages (about, services, contact, etc.). The slug in `getPage('<slug>')` matches the source markdown filename without extension.

Do NOT modify:
- `src/pages/404.astro` (no CMS data)
- `src/pages/robots.txt.ts` (no CMS data)
- `src/pages/healthz.ts` (just created, no CMS data)
- `src/pages/media/[...path].ts` (just created)

Verify no `astro:content` imports remain:
```bash
grep -rIn "astro:content" src/ && echo "FAIL: astro:content still referenced" || echo "OK: no astro:content imports"
```

Expected: "OK: no astro:content imports".

Commit:
```bash
git add src/pages/
git commit -m "refactor: rewrite page routes to use CMS reader"
```

---

### Group 4 — Source SEO components from CMS

Modify `src/layouts/BaseLayout.astro` to read site settings from CMS instead of importing `src/content/site.ts`.

**Strategy: use `Edit`, not `Write`.** The cloned site's `BaseLayout.astro` may include theme-specific `<Header>`/`<Footer>` slots, analytics, font preloads, custom `<meta>` tags, body-class hooks — none of which the conversion touches. Only the following lines change:

1. Replace `import { site } from '../content/site';` with `import { getSite } from '../lib/cms';`.
2. Add `const site = await getSite();` to the frontmatter (after the `Astro.props` destructure).
3. Wherever `site.X` is accessed in the template, change to `site?.X ?? <fallback>` (every access uses optional chaining + a meaningful default).
4. Wherever JSON-LD components are rendered (e.g., `<JsonLdOrganization />`), wrap with `{site && <JsonLdOrganization site={site} />}` and pass `site` as a prop. Same for `<JsonLdLocalBusiness>` (also wrapped in `{site?.nap && ...}`).

If the actual file's `<head>` or `<body>` contains tags or components this pattern doesn't anticipate, **leave them**. Do not "tidy" or rewrite them.

Reference before/after (sitegen-template's typical shape — your actual file may have more):

Before (typical shape — adapt to actual file):
```astro
---
import Seo from '../components/seo/Seo.astro';
import JsonLdOrganization from '../components/seo/JsonLdOrganization.astro';
import JsonLdLocalBusiness from '../components/seo/JsonLdLocalBusiness.astro';
import { site } from '../content/site';

interface Props {
  title?: string;
  description?: string;
  ogImage?: string;
}
const { title, description, ogImage } = Astro.props;
---

<!doctype html>
<html lang={site.language}>
  <head>
    <Seo title={title} description={description} ogImage={ogImage} />
    <JsonLdOrganization />
    {site.nap && <JsonLdLocalBusiness />}
  </head>
  <body>
    <slot />
  </body>
</html>
```

After:
```astro
---
import Seo from '../components/seo/Seo.astro';
import JsonLdOrganization from '../components/seo/JsonLdOrganization.astro';
import JsonLdLocalBusiness from '../components/seo/JsonLdLocalBusiness.astro';
import { getSite } from '../lib/cms';

interface Props {
  title?: string;
  description?: string;
  ogImage?: string;
}
const { title, description, ogImage } = Astro.props;
const site = await getSite();
---

<!doctype html>
<html lang={site?.language ?? 'en'}>
  <head>
    <Seo title={title ?? ''} description={description ?? ''} ogImage={ogImage} />
    {site && <JsonLdOrganization site={site} />}
    {site?.nap && <JsonLdLocalBusiness site={site} />}
  </head>
  <body>
    <slot />
  </body>
</html>
```

Modify `src/components/seo/JsonLdOrganization.astro` to accept `site` as a prop instead of importing it. Read existing file first; transform the import + access pattern. Render nothing if `site` is null/undefined.

Pattern (adapt to existing shape):
```astro
---
import type { SiteSettings } from '../../lib/types';

interface Props {
  site: SiteSettings;
}
const { site } = Astro.props;
const data = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: site.brand,
  url: `https://${site.primaryDomain}`,
  sameAs: Object.values(site.socials ?? {}).filter(Boolean),
};
---

<script type="application/ld+json" set:html={JSON.stringify(data)} />
```

Same treatment for `src/components/seo/JsonLdLocalBusiness.astro`. Render nothing if `site.nap` is undefined.

If the cloned site has `src/components/seo/Seo.astro` reading from `site` directly, give it the same prop-injection treatment.

Verify no `import .* from '.*content/site'` remains:
```bash
grep -rIn "content/site" src/ && echo "FAIL: still importing content/site" || echo "OK: no content/site imports"
```

Expected: "OK: no content/site imports".

Commit:
```bash
git add src/layouts/ src/components/seo/
git commit -m "refactor: source SEO components from CMS instead of site.ts"
```

---

### Group 5 — Update Dockerfile, delete nginx.conf

Read the existing Dockerfile first to understand its current shape. Replace the final stage. Target shape:

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=lts-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
ARG SITE_URL=https://example.com
ENV SITE_URL=${SITE_URL}
RUN pnpm build

FROM node:${NODE_VERSION}
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV CMS_DATA_DIR=/data

# Copy production deps + built server bundle
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz >/dev/null || exit 1

CMD ["node", "./dist/server/entry.mjs"]
```

Delete `nginx.conf`:
```bash
rm nginx.conf
```

Verify Dockerfile is node-based and nginx is gone:
```bash
grep -E "FROM nginx" Dockerfile && echo "FAIL" || echo "OK: no nginx FROM"
test ! -f nginx.conf && echo "OK: nginx.conf removed" || echo "FAIL: nginx.conf still present"
```

Both should print "OK".

Commit:
```bash
git add Dockerfile
git rm nginx.conf
git commit -m "chore: convert Dockerfile to Node SSR runtime, drop nginx.conf"
```

---

### Group 6 — Add docker-compose example, update env example, README note

Create `docker-compose.cms.yml.example` at the site repo root:

```yaml
# Example compose for site-<slug> in CMS-backed mode.
# Copy values into your VPS docker-compose file (or use this standalone if running this site alone).
#
# Replace <vps-data-path> with the absolute host path where Payload writes this tenant's data,
# e.g. /srv/data/saas/payload-siab/<tenantId>.

services:
  site:
    image: ghcr.io/optidigi/site-<slug>:latest
    restart: unless-stopped
    ports:
      - "4321:4321"
    volumes:
      - <vps-data-path>:/data:ro
    environment:
      CMS_DATA_DIR: /data
      CMS_TENANT_ID: <tenantId>
      SITE_URL: https://<primaryDomain>
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4321/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
```

Modify `.env.example` (read it first; preserve existing content). Append:

```
# CMS runtime (read by the SSR server)
CMS_DATA_DIR=/data
CMS_TENANT_ID=
```

Append to `README.md` (read first; preserve existing content):

```markdown

## CMS-backed mode

This site reads editorial content from a per-tenant Payload CMS data directory mounted into the container at `/data`. Editor changes are visible on the next request — there is no rebuild on content edits.

**Required runtime env:**

- `CMS_DATA_DIR` — defaults to `/data`. Where the per-tenant data is mounted.
- `CMS_TENANT_ID` — the Payload tenant ID for this site (set during CMS provisioning).
- `SITE_URL` — public site URL (e.g. `https://example.com`).

**Required volume:**

- Mount the per-tenant data dir at `/data:ro`. See `docker-compose.cms.yml.example`.

**Editor:**

The Payload tenant has an editor user; the operator manages account access.

**Failure modes:**

If `/data` is not mounted, or any page JSON is missing/malformed, the site renders with empty editorial fields. Pages always return 200; `/healthz` returns 200 unconditionally for container healthchecks.
```

Commit:
```bash
git add docker-compose.cms.yml.example .env.example README.md
git commit -m "docs: add docker-compose example, env example entries, README CMS section"
```

---

### Group 7 — Delete static content collection

```bash
rm -rf src/content/
rm -f src/content.config.ts
```

Verify no remaining references:
```bash
grep -rIn "content/site\|content/pages\|content.config\|astro:content" src/ && echo "FAIL: stale references remain" || echo "OK"
```

Expected: "OK".

Commit:
```bash
git add -u src/
git commit -m "chore: remove static content collection (source of truth now in payload)"
```

---

## Output contract

After all groups, return a markdown report:

```markdown
# Conversion report — site-<slug>

## Commits
- <sha> chore: install @astrojs/node and switch to SSR output
- <sha> feat: add cms reader, types, middleware, healthz, media route, blocks renderer
- <sha> refactor: rewrite page routes to use CMS reader
- <sha> refactor: source SEO components from CMS instead of site.ts
- <sha> chore: convert Dockerfile to Node SSR runtime, drop nginx.conf
- <sha> docs: add docker-compose example, env example entries, README CMS section
- <sha> chore: remove static content collection (source of truth now in payload)

## Files added
- src/lib/cms.ts
- src/lib/types.ts
- src/middleware.ts
- src/pages/healthz.ts
- src/pages/media/[...path].ts
- src/components/cms/Blocks.astro
- src/components/cms/RichText.astro
- docker-compose.cms.yml.example

## Files modified
- astro.config.mjs
- package.json (+ pnpm-lock.yaml)
- src/layouts/BaseLayout.astro
- src/components/seo/Seo.astro (if needed)
- src/components/seo/JsonLdOrganization.astro
- src/components/seo/JsonLdLocalBusiness.astro
- src/pages/index.astro (and other content-driven page routes)
- Dockerfile
- .env.example
- README.md

## Files deleted
- src/content/pages/*.md
- src/content/site.ts
- src/content.config.ts
- nginx.conf

## Notes
- (any deviations from the plan, surprises, parallel-workstream coordination needs)
```

End with: `**Status: clean — proceed to Phase 6 (build verify).**` if everything went smoothly.

If you bailed before completing all 7 groups, list ONLY the commits actually made (do not invent ones you didn't make), and add a `## Bail` section with: which group failed, what file or condition triggered the bail, and the exact diagnostic that caused the stop. End with: `**Status: bailed at Group N — operator action required.**`

## Hard rules

- **Never push.** Only local commits.
- Never delete anything outside the explicitly enumerated paths above.
- Never modify or delete anything under `public/`. The SEO baseline files there (`llms.txt`, `humans.txt`, `.well-known/security.txt`, favicons, manifest, og-default) must survive conversion untouched.
- Never modify non-content components (header, footer, theme components, contact form). They render fine independent of CMS.
- If any expected file is missing (e.g., `src/content/site.ts`), bail and report — do not invent a substitute.
- Use `Edit` for surgical modifications to existing files; only use `Write` for new files or when wholesale replacement is unavoidable. Read files before editing them.
- **Every reference to a `getSite()` / `getPage()` result uses `?.` or a guarded conditional.** No bare `site.X` or `page.X` access anywhere — the cms-reviewer (Phase 7) greps for these patterns and will fail the conversion otherwise.
- **Never modify dependencies after Group 1.** The only `pnpm add` is for `@astrojs/node`. If you encounter type errors that seem to need a missing `@types/*` package, bail and report — don't install.
- One logical group = one commit. Do NOT bundle multiple groups into one commit.
- After each commit, do a quick `git status` to confirm the working tree is clean before moving to the next group.
```

- [ ] **Step 2: Verify**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
head -5 .claude/agents/site-converter.md && wc -l .claude/agents/site-converter.md && grep -c "^### Group" .claude/agents/site-converter.md
```

Expected: YAML frontmatter, ~400+ lines, 7 groups.

- [ ] **Step 3: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add .claude/agents/site-converter.md
git commit -m "feat: add site-converter subagent spec"
```

---

## Task 9: .claude/agents/cms-reviewer.md (subagent spec)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents/cms-reviewer.md`

**Why:** Subagent contract for Phase 7. Audits the post-conversion site for completeness and defensive rendering. Uses `code-reviewer` agent type as base. Returns blocking + non-blocking findings.

- [ ] **Step 1: Write `cms-reviewer.md`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/.claude/agents/cms-reviewer.md`:

```markdown
---
name: cms-reviewer
description: Use during Phase 7 of the sitegen-cms runbook, after site-converter has finished. Audits the converted site for SSR conversion completeness, defensive rendering, security headers, healthz, and absence of leftover static-content references. Does not modify the site. Wraps the code-reviewer agent type with sitegen-cms-specific context.
tools: Read, Bash, Grep, Glob
---

You are a focused subagent. You're the final pre-sign-off gate for the CMS conversion. Review the converted site against the standards in `preflight.md` and the conversion contract in `docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md`. You don't modify anything.

## Inputs (provided in your dispatch prompt)

- **Path to** the converted site repo (`./site-<slug>/`).
- **Captured intake summary** (Phase 1 + 2 output).
- **Conversion report** from `site-converter` (Phase 5 output).

## What to check

### SSR conversion completeness

- `astro.config.mjs` declares `output: 'server'` and `adapter: node({ mode: 'standalone' })`. Grep:
  ```bash
  grep -E "output:\s*['\"]server['\"]" astro.config.mjs
  grep -E "node\(\{[^}]*mode:\s*['\"]standalone['\"]" astro.config.mjs
  ```
- `package.json` lists `@astrojs/node` in dependencies and has a `start` script.
- `pnpm build` succeeds:
  ```bash
  cd <site-repo> && pnpm install && pnpm build
  ```
  Confirm exit 0 and that `dist/server/entry.mjs` exists.

### CMS reader and types

- `src/lib/cms.ts` exists and exports `getPage`, `getSite`, `mediaPath`.
- `src/lib/types.ts` exists and exports `Page`, `SiteSettings`, `Block`, `RichTextBlock`.
- Both functions return `null` on error (no throws). Read the file and confirm a try/catch or equivalent guard.

### Defensive rendering everywhere

For every file under `src/pages/`, `src/layouts/`, `src/components/seo/`, `src/components/cms/`:

- Every CMS field access uses `?.` or a null check before access.
- Every interpolation of CMS data has a fallback (e.g., `page?.title ?? ''`).
- No code path throws when `getPage()` returns `null` or `getSite()` returns `null`.

Grep for crash-inducing patterns:
```bash
# Direct .data.* without optional chaining (would crash on null)
grep -rEn "page\.[a-z]" src/pages/ src/layouts/ src/components/
# Direct site. access without optional chaining
grep -rEn "site\.[a-zA-Z]" src/pages/ src/layouts/ src/components/seo/
```

For each match, verify it's defensive (e.g., `page?.title` is fine, `page.title` without the `?` is a finding).

### Middleware sets all required security headers

Read `src/middleware.ts`. Confirm all five headers are set on every response:

- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Content-Security-Policy`
- `Permissions-Policy`

If the original `nginx.conf` (now deleted, but reference the design spec or git history if needed) had different values, the middleware should match.

### Routes preserved + new routes present

- `src/pages/healthz.ts` exists, returns `Response('ok', { status: 200 })`. No CMS dependency.
- `src/pages/media/[...path].ts` exists. Path-traversal guard present (rejects paths that escape `MEDIA_DIR`).
- `src/pages/robots.txt.ts` unchanged (still present).
- `src/pages/404.astro` unchanged (still present).
- For every page in the intake's page list (e.g., `/`, `/about`, `/services`), there's a corresponding `src/pages/<route>.astro` that uses `getPage('<slug>')` (not `getEntry`).

### No leftovers

- `src/content/` is gone.
- `src/content.config.ts` is gone.
- `nginx.conf` is gone.
- No file under `src/` imports from `astro:content`:
  ```bash
  grep -rIn "astro:content" src/ && echo "BLOCKING" || echo "OK"
  ```
- No file under `src/` imports from `../content/site` or `../../content/site`:
  ```bash
  grep -rIn "content/site" src/ && echo "BLOCKING" || echo "OK"
  ```

### Compose example + env example + README

- `docker-compose.cms.yml.example` exists at repo root with `volumes:`, `environment:` (CMS_DATA_DIR, CMS_TENANT_ID, SITE_URL), and a healthcheck against `/healthz`.
- `.env.example` documents `CMS_DATA_DIR` and `CMS_TENANT_ID` (in addition to the existing `SITE_URL`).
- `README.md` has a "## CMS-backed mode" section.

### SEO baseline preserved (regression check)

- `public/llms.txt` still exists.
- `public/humans.txt` still exists.
- `public/.well-known/security.txt` still exists.
- `public/manifest.json` still exists.
- `public/favicon.svg` (or `.ico`) still exists.
- `public/apple-touch-icon.png` still exists.
- `public/og-default.png` still exists.

### Dockerfile sanity

- Final stage uses `node:lts-alpine` (not `nginx`).
- `EXPOSE` matches the port the entry binds (default 4321).
- `HEALTHCHECK` targets `/healthz` on the same port.
- `CMD` runs `node ./dist/server/entry.mjs` (or whatever the configured entry is).
- `ENV CMS_DATA_DIR=/data` set so the in-container default is correct.

## Output format

Return a markdown review:

```markdown
# Review — site-<slug> (CMS conversion)

## Blocking
- [category] short description + file path / line + concrete fix
- ...

## Non-blocking
- [category] short description
- ...

## Status

`Status: clean — ready for sign-off.`
*or*
`Status: <N> blocking items must be fixed before sign-off.`
```

## Hard rules

- Never modify the site.
- Be strict but specific — every blocking finding cites the file + line and a concrete fix. If you can't articulate a fix, it doesn't belong in blocking.
- A clean report ends with a single line: `Status: clean — ready for sign-off.`
- Always run `pnpm build` as part of the review. A build that fails is itself a blocking finding.
```

- [ ] **Step 2: Verify**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
head -5 .claude/agents/cms-reviewer.md && wc -l .claude/agents/cms-reviewer.md
```

Expected: YAML frontmatter, ~120-150 lines.

- [ ] **Step 3: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add .claude/agents/cms-reviewer.md
git commit -m "feat: add cms-reviewer subagent spec"
```

---

## Task 10: README.md (human-facing setup)

**Files:**
- Create: `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/README.md`

**Why:** What an operator reads first when they clone the orchestrator on a fresh machine. Covers what it is, prerequisites, setup, and how to run.

- [ ] **Step 1: Write `README.md`**

Write `/home/shimmy/Desktop/env/sitegen-cms-orchestrator/README.md`:

```markdown
# sitegen-cms-orchestrator

Workflow for adding a Payload v3 CMS layer to existing static Astro landing pages under `optidigi/site-<slug>`. Sibling to `optidigi/sitegen-orchestrator`.

After running, the target site is Astro SSR (Node) reading per-tenant content from a mounted Payload data directory. Editor changes are visible on the next request — no GitHub Actions runs, no GitHub PATs, no webhook bridge in the editing path.

See `docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md` for the full design.

## Prerequisites

- A target `optidigi/site-<slug>` repo (built and deployed by `sitegen-orchestrator`).
- A self-hosted Payload v3 instance reachable from the operator's machine (e.g. `https://cms.optidigi.nl`).
- A Payload Management API token with scopes `tenant:create`, `user:create`, `page:create`, `media:create`, `siteSettings:create`.
- A VPS host directory where Payload writes this tenant's content (typically `/srv/data/saas/payload-siab/<tenantId>/`). The site container will mount it read-only.
- Local tools: `gh` (authenticated as a member of `optidigi`), `git`, `node` ≥ 20, `pnpm` (via `corepack`), `curl`, `jq`, `python3`.

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
- Sibling repos cloned per-engagement and gitignored from this repo.

## Cleanup after a run

The cloned `./site-<slug>/` persists on disk for inspection. Remove manually when done:

```bash
rm -rf ./site-<slug>
```

The orchestrator never auto-deletes it.

## Re-running on a CMS-ified site

Not supported. The Phase 2 idempotency check bails. Manual reset path:

```bash
# In the cloned site repo:
git reset --hard origin/main
```

Plus delete the Payload tenant in Payload admin. Then re-run `/add-cms <slug>`.
```

- [ ] **Step 2: Verify**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
wc -l README.md && grep -c "^##" README.md
```

Expected: ~70-80 lines, ~7 H2 sections.

- [ ] **Step 3: Commit**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git add README.md
git commit -m "docs: write README with setup and usage"
```

---

## Task 11: Pre-publish smoke test + push to GitHub (operator-gated)

**Files:** none modified — this task verifies the repo state and pushes.

**Why:** Before pushing the orchestrator publicly, do a sanity sweep of the repo state. Then await the operator's approval and push to `optidigi/sitegen-cms-orchestrator`.

- [ ] **Step 1: Sweep the repo**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git status
git log --oneline
ls -la
ls -la .claude .claude/agents .claude/commands
ls -la docs/superpowers/specs docs/superpowers/plans
```

Expected:
- `git status` shows clean working tree
- `git log --oneline` shows ~10 commits in conventional-commit style, no "Generated with Claude Code" footers
- All workflow files present at expected paths

- [ ] **Step 2: Sanity-check no secrets leaked**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git ls-files | xargs grep -l 'PAYLOAD_API_TOKEN=[a-zA-Z0-9]' 2>/dev/null && echo "BLOCKED: token in tracked file" || echo "OK: no token in tracked files"
git ls-files | grep -E '^\.env$' && echo "BLOCKED: .env tracked" || echo "OK: .env not tracked"
```

Both should print "OK".

- [ ] **Step 3: Verify no "Generated with Claude Code" footers**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
git log --format="%B" | grep -i "generated with claude" && echo "BLOCKED" || echo "OK: no Claude footers"
```

Expected: "OK".

- [ ] **Step 4: Verify all referenced files exist**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
test -f CLAUDE.md && \
test -f preflight.md && \
test -f prompt.md && \
test -f README.md && \
test -f .gitignore && \
test -f .env.example && \
test -f .mcp.json && \
test -f .claude/settings.json && \
test -f .claude/commands/add-cms.md && \
test -f .claude/agents/payload-seeder.md && \
test -f .claude/agents/site-converter.md && \
test -f .claude/agents/cms-reviewer.md && \
test -f docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md && \
test -f docs/superpowers/plans/2026-05-03-sitegen-cms-orchestrator.md && \
echo "OK: all expected files present"
```

Expected: "OK: all expected files present".

- [ ] **Step 5: Show summary to operator and request push approval**

Show the operator:

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
echo "Files:" && find . -type f -not -path './.git/*' | sort
echo ""
echo "Commits:" && git log --oneline
```

**GATE:** ask the operator: "All workflow files written, repo state clean, ready to create the public repo and push to `optidigi/sitegen-cms-orchestrator`. Approve?"

- [ ] **Step 6: Create the GitHub repo and push (after operator approval)**

```bash
cd /home/shimmy/Desktop/env/sitegen-cms-orchestrator
gh repo create optidigi/sitegen-cms-orchestrator --public --source=. --remote=origin --push --description "Workflow for adding Payload v3 CMS to existing optidigi/site-<slug> repos"
```

Verify:

```bash
gh repo view optidigi/sitegen-cms-orchestrator
git log --oneline origin/main
```

Expected: repo created, commits pushed, `git log` shows the commits matching local main.

- [ ] **Step 7: Confirm to operator**

Print:

```
Done.

Orchestrator: optidigi/sitegen-cms-orchestrator (public)
Local clone:  /home/shimmy/Desktop/env/sitegen-cms-orchestrator/
Run with:     /add-cms <slug>  (from inside this orchestrator dir)
Spec:         docs/superpowers/specs/2026-05-03-sitegen-cms-orchestrator-design.md
Plan:         docs/superpowers/plans/2026-05-03-sitegen-cms-orchestrator.md
```

---

## Notes for the executing agent

- Follow tasks in order. Each task ends with a commit. Do not bundle commits across tasks.
- If a step's verify command surfaces an unexpected mismatch (e.g., `wc -l` reports a wildly different number), STOP and report — don't fudge the file to match the expected count.
- Use `Edit` over `Write` whenever modifying an existing file. Read the file first to confirm shape.
- Do NOT include "Generated with Claude Code" or "Co-Authored-By: Claude" footers in any commit. The operator's settings.json and brief are explicit.
- Phase 11 (push) is gated by operator approval. Do NOT push without it.
- If you discover the spec is wrong about something during execution (e.g., the existing template's BaseLayout has a different shape than the converter's "Before" sample assumes), report back to the operator before improvising — the spec may need a small amendment.
