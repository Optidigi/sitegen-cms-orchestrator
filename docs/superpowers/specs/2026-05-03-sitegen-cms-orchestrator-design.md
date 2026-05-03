# Sitegen CMS Orchestrator — Design

**Date:** 2026-05-03
**Status:** Approved (pre-implementation)
**Owner:** admin@optidigi.nl

## Purpose

Define a repeatable workflow that takes an existing static Astro landing-page site (one previously built and deployed by `sitegen-orchestrator`, living at `optidigi/site-<slug>`) and transforms it into a CMS-backed site driven by a self-hosted Payload v3 instance.

After running, the site:

- Has a Payload tenant provisioned for it.
- Pulls editorial content (page text, brand info, NAP, socials, media) from a per-tenant data directory mounted into its container at runtime.
- Falls back to empty fields if any content is missing — the site never breaks because of missing or malformed CMS data.
- Requires no GitHub credentials, no GitHub Actions runs, and no external service calls when editorial content changes. Payload writes JSON to disk; the site reads it on the next request.

This orchestrator is a **sibling** of `sitegen-orchestrator`, not its child. They share conventions because they're operated by the same person on the same conventions, not because either depends on the other.

## What this orchestrator modifies

Only two things, both per-engagement:

1. The cloned target site repo on disk (commits + push back to the same `optidigi/site-<slug>` origin on `main`).
2. A Payload tenant on the operator's Payload instance (created via Payload's REST API).

It does not modify `sitegen-template`, `sitegen-themes`, `sitegen-orchestrator`, or any other repo.

## Architecture overview

```
┌──────────────────┐  POST /api/...    ┌─────────────────────────────┐
│ cms-orchestrator │ ─────────────────▶│ Payload v3 (cms.optidigi.nl)│
│ (Claude Code in  │                   │  - tenants                  │
│ ~/Desktop/env/   │                   │  - users (per-tenant)       │
│ sitegen-cms-     │                   │  - pages (per-tenant)       │
│ orchestrator/)   │                   │  - siteSettings (1/tenant)  │
└────────┬─────────┘                   │  - media (per-tenant)       │
         │ git clone + commits         └────────┬────────────────────┘
         │ + push at sign-off                   │ afterChange hook
         ▼                                      │ writes JSON + media to disk
   ./site-<slug>/                               ▼
   (modified, pushed to                /srv/data/saas/payload-siab/<tenantId>/
   github.com/optidigi/site-<slug>)    ├── pages/<slug>.json
                                       ├── site.json
                                       └── media/<file>
                                                │ mounted read-only
                                                ▼
                                       Site container on VPS
                                       Astro SSR (Node), reads /data/
                                       Renders defensively, never crashes
                                       on missing / malformed fields
```

## Why these decisions (locked, do not relitigate)

| Decision | Rationale |
| --- | --- |
| Astro SSR with `@astrojs/node` standalone | Per-request render reads JSON from filesystem (microseconds); enables instant editor latency; defensive renderer means missing data never breaks the page. Filesystem-mediated edit flow eliminates GitHub credentials, GHA runs, and webhook bridges from the editing path. |
| No in-container nginx | Single-process container, security headers in Astro middleware, gzip in Node middleware. The operator's VPS reverse proxy already handles TLS + multi-site routing; an in-container nginx would be redundant. Smaller image, less moving parts. |
| Pre-serialized HTML on disk for richText block bodies | Parallel workstream's `afterChange` hook serializes Payload's Lexical editor format to HTML before writing the per-page JSON file. Site renders with `set:html`. Best WYSIWYG fidelity for editors; site code stays trivial (no Lexical renderer). |
| Auto-migrate images to Payload media at seed time | Editor sees existing images already attached to their pages on day one. Removes the "you'll need to re-upload these later" handoff step. |
| Site-wide data also lives in Payload (not the repo) | Single source of truth. `getSite()` reads `/data/site.json`. Brand/NAP/socials editable by the editor without code changes. |
| Markdown + content collection deleted in same commit as SSR conversion | No half-states. Source of truth is unambiguously Payload from commit forward. |
| `.env` in orchestrator working dir for `PAYLOAD_API_URL` + `PAYLOAD_API_TOKEN` | Standard Node-dev pattern; gitignored; per-clone. |
| Direct commits to local main; push only at sign-off gate | Operator reviews `git log`/`git diff` of the converted site before anything leaves the machine. Recovery from a failed run is `git reset --hard origin/main` (in `ask` list, not allowed automatically). |
| Editor invitations always to `admin@optidigi.nl` initially | Operator gates the handoff. Real client email goes in only when operator updates the user's email in Payload admin after end-to-end verification. Prevents the client receiving an invite to a broken integration. |
| Code injection into the cloned site, not template modification | Brief constraint: the four existing repos are untouchable in this engagement. CMS-ified sites diverge from `sitegen-template` and can't be `git pull`-updated. Acknowledged brittleness. Future direction would be native dual-mode support in `sitegen-template`. |

## Workflow phases

Sequential. Each `**GATE**` is a hard stop.

### Phase 1 — Intake

Operator runs `/add-cms <slug>`. Orchestrator:

- Confirms `.env` in working dir contains `PAYLOAD_API_URL` and `PAYLOAD_API_TOKEN`. Bail with diagnostic if missing.
- Pings `${PAYLOAD_API_URL}/api/health` (or equivalent). Bail if Payload is unreachable.
- Captures from operator (one-question-at-a-time):
  - VPS host path where Payload writes this tenant's data (e.g. `/srv/data/saas/payload-siab/<placeholder>` — operator pastes the real path; `<placeholder>` will be filled by tenant ID after Phase 3).
  - Optional: client editor email (recorded in run log only; the actual Payload user is created with `admin@optidigi.nl` regardless).

Summarize captured intake. **GATE:** operator approves.

### Phase 2 — Clone & inspect

```bash
gh repo clone optidigi/site-<slug> ./site-<slug>
cd ./site-<slug>
```

Bail if `./site-<slug>/` already exists locally (operator removes it or chooses different working dir).

Read and verify:

- `src/content/site.ts` exists and exports a `site: SiteConfig` matching the expected shape (brand, language, primaryDomain, etc.).
- `src/content/pages/` exists with at least one `*.md` file.
- `astro.config.mjs` exists with `output: 'static'` (sanity check we're operating on a non-CMS-ified site).
- `package.json` shows `astro` dependency at version `^6.x`.

If any check fails: bail with a list of unmet expectations. The orchestrator only operates on sites built by `sitegen-orchestrator`'s convention.

**Idempotency check:** if `src/lib/cms.ts` already exists OR `astro.config.mjs` has `output: 'server'` OR `docker-compose.cms.yml.example` exists → site appears already CMS-ified. Bail with diagnostic listing what was detected; force operator to do targeted things by hand. Do not attempt to "re-run" or "re-seed" automatically.

Show operator the derived metadata: brand, primaryDomain, page list with roles, NAP presence, socials presence. **GATE:** operator confirms this matches expectations.

### Phase 3 — Provision tenant

```bash
curl -X POST "${PAYLOAD_API_URL}/api/tenants" \
  -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "slug": "<slug>", "name": "<brand>", "primaryDomain": "<primaryDomain>" }'
```

Capture the returned tenant ID. Echo it to the operator.

If the response indicates "tenant already exists for this slug", bail (idempotency — operator chooses whether to delete the tenant manually or run on a different slug).

### Phase 4 — Seed content

Dispatch `payload-seeder` subagent with:

- Site repo path
- Tenant ID
- Payload API URL + token
- Path to `src/content/pages/` (markdown source)
- Parsed `src/content/site.ts` data

The subagent:

1. For each markdown file in `src/content/pages/`:
   - Parses YAML frontmatter and markdown body.
   - Scans body for image references (`![alt](path)` syntax). For each:
     - POSTs the image binary to `${PAYLOAD_API_URL}/api/media` (multipart form, `tenant: <id>`).
     - Captures the returned media URL/ID.
     - Rewrites the body's image reference to point at the Payload media URL.
   - Splits the rewritten body on H2 boundaries. Each section becomes a `richText` block: `{ heading: <H2 text>, body: <markdown of section excluding the H2 line itself> }`. Body markdown is converted to whatever input format the parallel workstream's `pages` collection accepts (default assumption: Payload Lexical JSON via `@payloadcms/richtext-lexical`'s markdown adapter).
   - POSTs the page to `${PAYLOAD_API_URL}/api/pages` with `{ tenant, slug, title, description, keywords, role, order, ogImage?, blocks }`.
2. POSTs the site-wide settings to `${PAYLOAD_API_URL}/api/siteSettings` with `{ tenant, brand, language, primaryDomain, aliases, description, nap?, hours?, serviceArea?, socials, nav }`.
3. Returns a markdown report listing pages created (with IDs), media uploaded (with URLs), siteSettings created.

If any single page or media upload fails: subagent reports the failure and stops. Operator decides whether to delete partial content in Payload admin and re-run (the orchestrator itself will refuse to re-run because of the idempotency check in Phase 2).

### Phase 5 — Convert site

Dispatch `site-converter` subagent with:

- Site repo path
- Tenant ID
- Primary domain

The subagent performs all SSR-conversion surgery (detailed in **Surgery** section below). It commits each logical group of changes as a separate commit on `main`:

- `chore: install @astrojs/node and switch to SSR output`
- `feat: add cms.ts reader and middleware for headers`
- `refactor: rewrite page routes to use CMS reader`
- `refactor: source SEO components from CMS instead of site.ts`
- `chore: update Dockerfile for Node SSR runtime`
- `chore: add docker-compose.cms.yml.example and .env.example entries`
- `chore: remove static content collection`

Returns a report listing commits + a summary of file changes.

### Phase 6 — Build verify

In the converted site dir:

```bash
pnpm install
pnpm build
```

`pnpm build` produces an Astro server bundle (in `dist/server/`). It does NOT need the `/data` directory — content is read at runtime.

If the build fails: orchestrator inspects the error, fixes if obvious (missing import, typo), re-runs. After 2 failed attempts, escalates to operator.

### Phase 7 — Review

Dispatch `cms-reviewer` subagent (uses `code-reviewer` agent type as base) with:

- Site repo path
- Captured intake summary
- List of changes from `site-converter`'s report

The subagent audits (full criteria in **Subagents** section below). Returns blocking + non-blocking findings.

If blocking findings: address them, re-run. **Max 2 loops.** After 2, escalate to operator with current state.

### Phase 8 — Invite editor

```bash
# 1. Create user
curl -X POST "${PAYLOAD_API_URL}/api/users" \
  -H "Authorization: Bearer ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@optidigi.nl",
    "password": "<random 32-char>",
    "tenant": "<tenantId>",
    "role": "editor"
  }'

# 2. Trigger forgot-password so admin@optidigi.nl gets a "set password" email
#    regardless of whether auth.verify is configured on the users collection.
curl -X POST "${PAYLOAD_API_URL}/api/users/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@optidigi.nl" }'
```

The random password is never logged or surfaced. The forgot-password email is the only path to login.

### Phase 9 — Sign-off + push

Print to operator:

- `git log --oneline main` (the commits site-converter made)
- `git diff <pre-conversion-sha>..HEAD --stat`
- Payload admin URL for visual inspection: `${PAYLOAD_API_URL}/admin/collections/pages?where[tenant][equals]=<tenantId>`
- Drop-in compose snippet (the lines to add to the operator's existing VPS compose):
  ```yaml
  services:
    site-<slug>:
      image: ghcr.io/optidigi/site-<slug>:latest
      restart: unless-stopped
      volumes:
        - <vps-host-path-from-intake>:/data:ro
      environment:
        CMS_DATA_DIR: /data
        CMS_TENANT_ID: <tenantId>
        SITE_URL: https://<primaryDomain>
  ```
- Reminder: "Editor invitation went to admin@optidigi.nl. Verify everything works end-to-end. When you're ready to hand off to the client, update the user's email in Payload admin to the client address (`<email-from-intake>` if you supplied one)."

**GATE:** operator approves.

On approval:

```bash
git push origin main
gh run watch --exit-status
```

Confirm the new image landed: `gh api /orgs/optidigi/packages/container/site-<slug>/versions | head -20` (look for the latest tag matching the new commit SHA).

### Phase 10 — Verify end-to-end

Walk operator through:

1. Update the VPS compose using the snippet above. `docker compose pull && docker compose up -d` for the site service.
2. Hit the live site URL. Confirm pages render (with seeded content visible).
3. Open Payload admin (`admin@optidigi.nl` link from the email). Edit a visible field on the homepage (e.g., the H1 heading). Save.
4. Hard-refresh the live site URL. Confirm the change is visible.

**GATE:** operator confirms the round-trip works.

If the round-trip fails: orchestrator helps diagnose by checking:

- Does `/data/pages/index.json` on the VPS exist and contain the new content? (Operator runs `cat` for us.)
- Is the site container's healthcheck passing? (`docker ps` for the site service.)
- Does the site's `/healthz` return 200? (curl from operator's machine.)

Fixes are case-by-case. Common failure modes covered in **Failure handling**.

Done. Orchestrator working dir keeps `./site-<slug>/` for the operator to inspect/cleanup at their leisure (no auto-rm).

## Subagents

### `payload-seeder`

- **Tools:** `Read`, `Bash`
- **Triggered:** Phase 4
- **Input (in dispatch prompt):**
  - Absolute path to site repo
  - Tenant ID (from Phase 3)
  - `PAYLOAD_API_URL` and `PAYLOAD_API_TOKEN` (orchestrator passes these explicitly so subagent doesn't need its own env)
  - Parsed contents of `src/content/site.ts` (orchestrator does the TS parse and passes a JSON blob)
  - List of `src/content/pages/*.md` paths
- **Behavior:** as detailed in Phase 4 above.
- **Output:** markdown report:
  ```markdown
  # Seed report — tenant <id>

  ## Pages created
  - / (home) → page id <pid>, 3 blocks, 2 images migrated
  - /about (about) → page id <pid>, 2 blocks, 0 images
  - ...

  ## Media uploaded
  - hero-banner.jpg → /api/media/<id> → /data/media/hero-banner-<hash>.jpg
  - ...

  ## Site settings
  - siteSettings created (id <sid>) with brand, language, primaryDomain, NAP, socials

  ## Failures
  - (none) | <list>
  ```
- **Hard rules:**
  - Never modifies any file in the site repo. Only POSTs to Payload.
  - On any failure mid-stream: stop and report. Do not attempt rollback (orchestrator handles via Phase 2 idempotency check on next run).
  - Image upload failures: report the image, skip its content reference (replace with `<!-- TODO: upload <filename> in Payload admin -->`), continue with the page.

### `site-converter`

- **Tools:** `Read`, `Write`, `Edit`, `Bash`
- **Triggered:** Phase 5
- **Input:**
  - Absolute path to site repo
  - Tenant ID
  - Primary domain
- **Behavior:** all surgery in **Surgery** section below. One git commit per logical group.
- **Output:**
  ```markdown
  # Conversion report — site-<slug>

  ## Commits
  - <sha> chore: install @astrojs/node and switch to SSR output
  - <sha> feat: add cms.ts reader and middleware for headers
  - ...

  ## Files modified
  - astro.config.mjs
  - package.json
  - ...

  ## Files added
  - src/lib/cms.ts
  - src/middleware.ts
  - ...

  ## Files deleted
  - src/content/pages/index.md
  - src/content/site.ts
  - src/content.config.ts
  - ...
  ```
- **Hard rules:**
  - Never pushes. Only local commits.
  - Never deletes anything outside the explicitly enumerated paths in **Surgery**.
  - Never modifies non-content components (header, footer, contact form, theme components in `src/components/<theme>/`).
  - Bails (and reports) if expected files are missing.

### `cms-reviewer`

- **Tools:** `Read`, `Bash`, `Grep`, `Glob`
- **Base:** uses `code-reviewer` agent type
- **Triggered:** Phase 7
- **Input:**
  - Absolute path to site repo
  - Captured intake summary
  - List of changes from `site-converter`'s report
- **Reviews:**
  - **Page routes:** every `src/pages/*.astro` that previously called `getEntry('pages', ...)` now calls `getPage(...)` from `src/lib/cms.ts`. No remaining `getEntry`/`getCollection`/`astro:content` imports anywhere.
  - **Defensive rendering:** every CMS field accessed in `src/pages/`, `src/layouts/`, `src/components/seo/` uses `?.` or a conditional guard. `cms-reviewer` greps for the patterns that would crash on null.
  - **Middleware:** `src/middleware.ts` exists and sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`, `Permissions-Policy` on every response.
  - **Astro config:** `output: 'server'` set; `@astrojs/node` adapter present in mode `'standalone'`.
  - **Dockerfile:** final stage is `node:lts-alpine` based; no `nginx` references remain; CMD/ENTRYPOINT runs `node ./dist/server/entry.mjs` (or the configured entry); `EXPOSE 4321` (Astro Node default) or whatever port the entry uses.
  - **Healthz:** `src/pages/healthz.ts` exists, returns `new Response('ok', { status: 200 })`. Dockerfile HEALTHCHECK targets `http://127.0.0.1:<port>/healthz`.
  - **Deleted artifacts:** `src/content/`, `src/content.config.ts` are gone. No code imports them.
  - **Env config:** `.env.example` documents `CMS_DATA_DIR`, `CMS_TENANT_ID`, `SITE_URL` (the existing `SITE_URL` is preserved).
  - **Compose example:** `docker-compose.cms.yml.example` exists at repo root with the documented shape.
  - **Build sanity:** runs `pnpm build` and confirms exit 0.
  - **Security baseline preserved:** all the original SEO baseline files (`public/llms.txt`, `public/humans.txt`, `public/.well-known/security.txt`, `public/manifest.json`, favicons, `og-default.png`) are still in place.
- **Output:** blocking + non-blocking findings markdown report.
- **Hard rules:**
  - Never modifies the site.
  - Be specific: every blocking finding cites the file + line and a concrete fix.
  - A clean report ends with `Status: clean — ready for sign-off.`

## Surgery the `site-converter` performs

### Modified files

| File | Change |
| --- | --- |
| `astro.config.mjs` | Set `output: 'server'`. Add `import node from '@astrojs/node'` and `adapter: node({ mode: 'standalone' })`. Keep existing `site`, `integrations: [sitemap()]`, Tailwind vite plugin, `build.inlineStylesheets`. |
| `package.json` | `pnpm add @astrojs/node`. (Adapter is the only new dependency.) Add `"start": "node ./dist/server/entry.mjs"` to scripts. |
| `Dockerfile` | Replace nginx final stage. New shape:<br>`FROM node:lts-alpine AS build` (build stage, unchanged: pnpm install + pnpm build).<br>`FROM node:lts-alpine` (final stage): copy `dist/`, `node_modules/` (or re-install prod-only), set `WORKDIR /app`, `ENV PORT=4321 HOST=0.0.0.0`, `EXPOSE 4321`, `HEALTHCHECK CMD wget -qO- http://127.0.0.1:4321/healthz \|\| exit 1`, `CMD ["node", "./dist/server/entry.mjs"]`. |
| `nginx.conf` | **Deleted.** |
| `.dockerignore` | Add `dist/`, `node_modules/` to ignored paths if not already (so Docker COPY context stays small). |
| `src/pages/index.astro` and any other content-driven `src/pages/*.astro` | Replace `getEntry('pages', '<slug>')` + `<Content />` pattern with `getPage('<slug>')` + `<Blocks blocks={page?.blocks ?? []} />`. Pass page metadata to BaseLayout defensively (`title={page?.title ?? ''}`, etc.). |
| `src/layouts/BaseLayout.astro` | Accept optional `page` (or `title`/`description`/`ogImage` defaulting to empty strings). Read site-wide data from `getSite()` instead of importing `site.ts`. JSON-LD components receive `siteSettings` as a prop. |
| `src/components/seo/Seo.astro` | Source `lang`/`title`/`description`/canonical from props (already does for title/description; lang now sourced from `siteSettings.language ?? 'en'`). |
| `src/components/seo/JsonLdOrganization.astro` | Read brand/primaryDomain/socials from `siteSettings` prop instead of importing `site.ts`. Render nothing if `siteSettings` is null. |
| `src/components/seo/JsonLdLocalBusiness.astro` | Read NAP/hours/serviceArea from `siteSettings` prop. Render nothing if `siteSettings?.nap` is null. |
| `src/pages/robots.txt.ts` | Unchanged — works in SSR. |
| `.env.example` | Add: `CMS_DATA_DIR=/data`, `CMS_TENANT_ID=`, keep existing `SITE_URL=`. |
| `README.md` | Append a "## CMS-backed mode" section: env vars, volume mount, where editor logs in, how to update content. |

### New files added

| File | Purpose |
| --- | --- |
| `src/lib/cms.ts` | `getPage(slug): Promise<Page \| null>` reads `${CMS_DATA_DIR}/pages/<slug>.json`, parses with try/catch, returns null on any error.<br>`getSite(): Promise<SiteSettings \| null>` reads `${CMS_DATA_DIR}/site.json`, same error behavior.<br>`mediaPath(file: string): string` returns `${CMS_DATA_DIR}/media/${file}`. |
| `src/lib/types.ts` | TypeScript types: `Page`, `SiteSettings`, `Block`, `RichTextBlock`. Mirror the contract in **Payload ↔ site contract** below. |
| `src/middleware.ts` | Astro `onRequest` middleware that sets all required security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: <existing template's policy>`, `Permissions-Policy: <existing template's policy>`. |
| `src/components/cms/Blocks.astro` | Renders an array of blocks. Iterates over `blocks ?? []`. Switches on `blockType` and delegates to per-block component. Unknown blockType: skip + log to stderr. |
| `src/components/cms/RichText.astro` | Renders a richText block: `<section><h2>{block.heading}</h2><div set:html={block.body ?? ''}/></section>`. The `body` is HTML pre-serialized by Payload's afterChange hook. |
| `src/pages/healthz.ts` | `export const GET = () => new Response('ok', { status: 200 });` — Docker healthcheck target. Independent of CMS data. |
| `src/pages/media/[...path].ts` | Serves files from `${CMS_DATA_DIR}/media/<path>` with appropriate Content-Type. Reads the file with `fs.createReadStream`, sets `Cache-Control: public, max-age=31536000, immutable` (filenames are content-hashed by Payload), returns 404 if the file doesn't exist. Required: Astro's static dir mapping is not viable here because `/data/` is mounted at runtime, not present at build. |
| `docker-compose.cms.yml.example` | Standalone reference compose for this site, with the volume mount + env vars + restart policy + healthcheck. Annotated with comments pointing at what to customize per VPS. |

### Deleted files

| File | Why |
| --- | --- |
| `src/content/pages/*.md` | Content now lives in Payload. No fallback in repo. |
| `src/content/site.ts` | Site-wide data now lives in Payload. |
| `src/content.config.ts` | Astro content collection no longer used. |
| `nginx.conf` | No in-container nginx. |

## Payload ↔ site contract

Both sides of the contract must honor this. The orchestrator implements the site side; the parallel workstream implements the Payload side.

### Filesystem layout

The parallel workstream's Payload `afterChange` hook for the per-tenant `pages`, `siteSettings`, and `media` collections writes to:

```
<tenant data root>/
├── pages/
│   ├── index.json
│   ├── about.json
│   └── ...
├── site.json
└── media/
    ├── hero-<hash>.jpg
    ├── logo-<hash>.svg
    └── ...
```

The site container mounts `<tenant data root>:/data:ro`. Site code reads via `process.env.CMS_DATA_DIR` (defaults to `/data`).

The `<tenant data root>` is operator-supplied at intake. Convention (not enforced): `/srv/data/saas/payload-siab/<tenantId>/`.

### Page JSON schema

```typescript
type Page = {
  id: string;                // Payload-assigned
  slug: string;              // 'index', 'about', etc.
  title: string;             // ≤70 chars
  description: string;       // ≤160 chars
  keywords: string[];
  ogImage?: string;          // path under /data/media/ or full URL
  role: 'home' | 'about' | 'services' | 'contact' | 'page';
  order: number;
  blocks: Block[];
  updatedAt: string;         // ISO 8601
};

type Block = RichTextBlock;  // future: | HeroBlock | FaqBlock | ...

type RichTextBlock = {
  blockType: 'richText';
  heading?: string;          // H2 text
  body: string;              // pre-serialized HTML
};
```

### Site JSON schema

```typescript
type SiteSettings = {
  brand: string;
  language: string;          // 'nl', 'en', etc.
  primaryDomain: string;
  aliases: string[];
  description: string;
  nap?: NAP;
  hours?: OpeningHours[];
  serviceArea?: string[];
  socials: { facebook?, instagram?, linkedin?, youtube?, x? };
  nav: { label: string; href: string }[];
  updatedAt: string;
};
```

(NAP and OpeningHours mirror the existing `src/content/site.ts` shapes.)

### Media

The parallel workstream's `afterChange` on the `media` collection writes the original (and any optimized variants it generates) into `<tenant data root>/media/`. File naming includes a hash to avoid collisions. Image references in page blocks point at paths relative to `/data/media/` (e.g., `/media/hero-abc123.jpg`).

The site serves these via the passthrough route `src/pages/media/[...path].ts`, which reads from `${CMS_DATA_DIR}/media/` and returns with appropriate Content-Type and a long-cache header (filenames are content-hashed by Payload, so cache forever is safe).

## Failure handling per phase

| Phase | Failure | Behavior |
| --- | --- | --- |
| 1 | `.env` missing keys | Bail with diagnostic listing the keys needed. |
| 1 | Payload unreachable | Bail with the URL and the error returned. Do not retry. |
| 2 | `gh repo clone` fails | Bail. Likely auth or repo doesn't exist. Operator handles. |
| 2 | Site doesn't match conventions | Bail with list of unmet expectations. Orchestrator only operates on sitegen-orchestrator-shaped sites. |
| 2 | Idempotency check fires | Bail. Operator must do targeted things by hand (delete tenant in Payload admin + revert commits in site repo) before re-running. |
| 3 | Tenant create returns 4xx | Bail. Show the response. Operator decides whether the schema mismatch is in their Payload setup or in the orchestrator's payload. |
| 4 | Page seed fails partway | Subagent stops, reports what was created. Orchestrator stops the run. Operator deletes the partial tenant in Payload admin and re-runs (which will idempotency-bail until they delete). |
| 4 | Image upload fails for one image | Subagent skips the image (replaces ref with TODO comment in body), continues with the page. Reports in seed report. |
| 5 | site-converter hits unexpected file shape | Bail with diagnostic. Operator inspects manually. Fix and re-run (after Phase 2 idempotency reset). |
| 6 | `pnpm build` fails | Orchestrator inspects, fixes obvious errors, retries. Max 2. Then escalate. |
| 7 | Reviewer reports blocking | Address, re-run. Max 2 loops. Then escalate. |
| 8 | User create returns 4xx | Bail. Likely tenant/role schema mismatch. Operator inspects parallel workstream's collection config. |
| 9 | Operator rejects sign-off | Collect feedback. Return to whichever phase the change belongs in. Do not auto-redo unrelated phases. |
| 9 | `git push` fails | Likely auth. Operator handles. Orchestrator does NOT force-push. |
| 9 | GHA build fails | `gh run watch` shows logs. Code issue → fix and push again. Infra issue (token, perms) → escalate with exact error. |
| 10 | Round-trip verification fails | Diagnose: check `/data/pages/<slug>.json` exists and is fresh on VPS; check container healthcheck; check site `/healthz` returns 200. Cause-by-cause from there. |
| any | Operator says "abort" | Stop cleanly. Do NOT delete `./site-<slug>/`. Do NOT delete the Payload tenant (operator's call). Report current phase + state. |

## State across runs

- `./site-<slug>/` persists on disk. The orchestrator does not auto-cleanup. Operator removes manually when done inspecting.
- The Payload tenant persists. If a run fails partway and the operator wants to retry, they delete the tenant in Payload admin first.
- If an operator wants to re-run `/add-cms` on a site that's already been CMS-ified, the Phase 2 idempotency check will bail. Operator must manually revert the site repo (`git reset --hard origin/main` after deleting the local clone is the cleanest path) and delete the Payload tenant before re-running.

## Re-engagements

If the parallel workstream changes the Payload schema (new collection, new field), CMS-ified sites might need re-conversion to read the new shape. Two paths:

- For trivial changes (a new optional field): edit `src/lib/types.ts` and the renderer in the live site repo manually. No re-run.
- For breaking changes: re-run `/add-cms` (after the manual revert above). Practically a fresh CMS-ification.

This orchestrator does not currently support a "patch existing CMS-ified site" mode. YAGNI for v1.

## Out of scope (explicitly)

- Payload's deployment, schema design, multi-tenancy plugin choice, `afterChange` hook implementation, `users` collection auth config, media optimization on upload — all parallel workstream.
- VPS-side compose templating, reverse-proxy config, TLS certs, DNS — operator's existing tooling.
- Draft/preview workflows (Payload supports drafts; we don't wire them in v1).
- Multi-language sites (single language v1).
- Editor permission tiers beyond "editor" role.
- Analytics integration (the site doesn't change; if the original had Plausible, it stays).
- SEO re-runs (the original site already cleared the SEO baseline; CMS-ification preserves it).
- Auto-cleanup of `./site-<slug>/` after a successful run.
- A "patch existing CMS-ified site" mode — re-run requires manual revert.
- Modifying `sitegen-template`, `sitegen-themes`, or `sitegen-orchestrator`. Future work to add native dual-mode (static OR cms-backed) support to `sitegen-template` would obsolete most of this orchestrator's surgery — that's a separate workstream.
