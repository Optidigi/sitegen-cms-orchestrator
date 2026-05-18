# payload-seeder: RT v2 + current-schema readiness

**Status:** Draft for review
**Date:** 2026-05-18
**Backlog (in siab-payload):** `docs/backlog/features/README.md` — OBS-49 (siab-payload-orchestrator: payload-seeder emits siteManifest) · `docs/backlog/infra/README.md` — OBS-56 (sister-repo sync)
**Depends on:**
- `siab-payload@main` `c699678` (OBS-57 closed — `siteManifest.blocks[]` + `enforceTenantBlockMenu` hook + per-block `anchor`)
- `siab-site-template@main` `ea3abc7` (OBS-56 contract foundation — `siteManifest.example.json` shipped + RtRoot-aware renderers)
- `siab-site-orchestrator@main` `7d1144e` (CMS-ification readiness — Phase 2 now generates per-tenant `siteManifest.json` at site repo root)
**Blocks:** `site-converter` spec (next) · fresh `/add-cms` runs on amblast + siteinabox

---

## 1. Context

`siab-payload-orchestrator` is the workshop repo that runs the `/add-cms <slug>` workflow — CMS-ifies an existing static `optidigi/site-<slug>` site by provisioning a tenant, seeding content via the `payload-seeder` subagent, and surgically converting the site to SSR + Payload-data-driven via the `site-converter` subagent.

The `payload-seeder` subagent (Phase 4 of the 10-phase runbook, ~278 lines at `.claude/agents/payload-seeder.md`) reads markdown files from the cloned site's `src/content/pages/*.md`, parses YAML frontmatter, detects + uploads images to Payload media, splits the body on H2 boundaries into sections, converts each section's markdown to HTML via `marked`, and POSTs each section as a `richText` block. It also POSTs `siteSettings`.

**The seeder is currently broken against current `siab-payload`:**
- `validateRichTextOnSave.ts` (Pages collection `beforeValidate` hook) parses every `richText.body` against `rtRootSchema` (an `RtRoot` discriminated-union). A POST with `body: "<HTML string>"` fails `safeParse` → hook throws `Error("Rich text validation failed: …")` → page POST returns 500 → seeder's "Page POST failures: stop. Surface the error response." rule halts the run.
- `RichText.ts` schema has only `body` (json, required) + `anchor` (text, optional). The seeder's POST includes a `heading` field that no longer exists — silently dropped.
- `Pages.ts` schema has `seo` as a group containing `title`/`description`/`ogImage`. The seeder posts top-level `description`/`ogImage` — they don't reach `seo` group. Also POSTs `role`/`order`/`keywords` which aren't in the schema at all.
- `Tenants.ts` has a `siteManifest` json field that nothing currently writes (OBS-49 open).

**Net:** the seeder hard-fails on the first page POST. Nobody has hit this yet because no `/add-cms` run has happened since RT v2 landed. amblast + siteinabox migrations (next round of work) need this fixed first.

### Verified against source (claim → file:line evidence)

| Claim | Evidence |
|---|---|
| `richText.body` must be RtRoot, not string | `siab-payload/src/blocks/RichText.ts:19` `type: "json"`; `siab-payload/src/hooks/validateRichTextOnSave.ts:46` `safeParse(value)` against `rtRootSchema`; throws on failure |
| `richText` has no `heading` field | `siab-payload/src/blocks/RichText.ts:18-30` fields list shows only `body` + `anchor` |
| Pages has `seo` group, not flat fields | `siab-payload/src/collections/Pages.ts:129-133` |
| Pages has no `role`/`order`/`keywords` | `siab-payload/src/collections/Pages.ts:118-136` (no such fields) |
| Pages has required `status` defaulting to `"draft"` | `siab-payload/src/collections/Pages.ts:122-126` |
| Tenant has `siteManifest` json field | `siab-payload/src/collections/Tenants.ts:81` |
| `enforceTenantBlockMenu` rejects out-of-menu blocks | `siab-payload/src/collections/Pages.ts:138` hook wired; `siab-payload/src/hooks/enforceTenantBlockMenu.ts` (post-OBS-57) |
| DEFAULT_MANIFEST only allows paragraph + h2/h3 + bold/italic | `siab-payload/src/lib/richText/loadManifest.ts:17-23` |
| Without OBS-49, markdown lists/quotes/dividers fail validation | DEFAULT_MANIFEST has no `bulletList`/`orderedList`/`blockquote`/`divider`; `validateAgainstManifest` rejects them |

## 2. Goals

1. **Fix the rich-text block POST shape.** `body` becomes `RtRoot` (block variant); drop `heading` (no longer in schema); add optional `anchor` (slug of the H2 heading text — supports in-page nav post-CMS-ification).
2. **Fix the page POST body.** Nest `description`/`ogImage` under `seo` group; drop dead top-level fields (`role`, `order`, `keywords`); explicit `status: "published"` (per the answered scope question — preserves continuity with the pre-CMS-ification public state of the static site).
3. **Seed `Tenant.siteManifest`** (closes OBS-49). Read `siteManifest.json` from the cloned site repo root (now reliably present per the just-shipped site-orchestrator update). Fallback to `siteManifest.example.json`. If neither exists, log warning + continue (don't fail the seed — siab-payload's `loadTenantManifest` falls back to `DEFAULT_MANIFEST`, but lists/quotes will then fail validation).
4. **Ship `scripts/md-to-rtroot.mjs`** as a small Node helper. Reads markdown from stdin, emits `RtRoot` JSON (block variant) to stdout using `marked.lexer()` to parse the markdown AST + a walker that maps tokens to RtNode types per the rt-dom-contract.

## 3. Non-goals

- **Other block types (Hero, FAQ, CTA, Testimonials, FeatureList, ContactSection).** Markdown doesn't carry their structure; operator adds them in Payload admin post-seed. Spec stays narrowly RichText-focused.
- **Themed-node generation in seeded content.** Same reason — markdown has no themed-node concept. Operator adds in admin.
- **`siab-payload` version pinning.** Separate concern (raised in earlier audit but out of OBS-49 scope).
- **`site-converter` changes.** Next spec.
- **`cms-reviewer` changes.** Folds into `site-converter` spec (more topically aligned with conversion contract).
- **`prompt.md` Phase 4 dispatch instructions.** No changes — the dispatch passes the same inputs (site repo path, tenant ID, Payload creds, parsed siteSettings, page paths); the seeder just does more correct things with those inputs.
- **In-place migration of existing CMS-ified tenants.** amblast + siteinabox are pre-CMS (not yet CMS-ified), so this is fresh `/add-cms` workflow — no migration code needed. If any tenant was previously CMS-ified pre-RT-v2 and needed in-place upgrade, that would be a separate one-off script.

## 4. Architecture

### 4.1 New file: `scripts/md-to-rtroot.mjs`

Single-file Node helper at orchestrator root (sibling of `prompt.md` / `preflight.md` / `CLAUDE.md`). Self-contained, no shared modules.

**Behaviour:**
- Reads markdown from `stdin` (file descriptor 0)
- Parses with `marked.lexer()` (already a transitive dep when seeder calls `npx --yes marked`; we'll vendor it explicitly via `package.json`)
- Walks the token tree, mapping to RtNode types per `siab-payload/docs/runbooks/rt-dom-contract.md`
- Emits `RtRoot` (block variant) JSON to `stdout`
- On unsupported tokens (e.g. tables — not in RtNode contract), writes a stderr warning + skips that token

**Token mapping (marked → RtNode):**

| `marked` token type | RtNode emission |
|---|---|
| `heading` (depth 2/3/4) | `{ t: "heading", level: depth, children: <inline> }` |
| `heading` (depth 1 or >=5) | skip (h1 owned by page title; h5+ not in contract) |
| `paragraph` | `{ t: "paragraph", children: <inline> }` |
| `list` (ordered or unordered) | `{ t: "list", ordered, items: [{ t: "listItem", children: <blocks> }, ...] }` |
| `blockquote` | `{ t: "blockquote", children: <blocks> }` |
| `hr` | `{ t: "divider" }` |
| `code` (fenced block) | `{ t: "paragraph", children: [{ t: "text", v: <code>, marks: ["code"] }] }` (RtNode has no block-code type — render inline as a fallback) |
| `space` / `html` / `table` | skip + stderr warning if non-trivial |
| `text` (inline) | `{ t: "text", v: <text> }` |
| `strong` | wrap inline children with mark "bold" |
| `em` | wrap inline children with mark "italic" |
| `codespan` | `{ t: "text", v: <text>, marks: ["code"] }` |
| `del` | wrap inline children with mark "strikethrough" |
| `link` | `{ t: "link", href, rel: (http? "external" : "internal"), children: <inline> }` |
| `br` | `{ t: "linebreak" }` |
| `image` (inline) | skip + stderr warning ("inline images not yet supported — use markdown image syntax outside RtRoot via Hero/FeatureList blocks instead") |

**Companion `scripts/package.json`** (pin `marked` so the helper's behaviour is stable across orchestrator runs):
```json
{
  "name": "siab-payload-orchestrator-scripts",
  "private": true,
  "type": "module",
  "dependencies": {
    "marked": "^14.0.0"
  }
}
```
Helper installs via `cd scripts && npm install --silent` lazily on first invocation (or once during preflight if Phase 0 wants to warm it). Avoids polluting the orchestrator-level node_modules with the seeder's helpers.

### 4.2 `payload-seeder.md` step 4 — replace markdown→HTML with markdown→RtRoot

**Current behaviour (lines 91-114):** splits body on H2 boundaries; converts each section's markdown to HTML via `npx --yes marked`; packs as `{blockType: "richText", heading: "<H2 text>", body: "<HTML string>"}`.

**New behaviour:** splits body on H2 boundaries; converts each section's markdown to RtRoot via `node scripts/md-to-rtroot.mjs` (piping the section markdown on stdin); packs as:

```json
{
  "blockType": "richText",
  "body": <RtRoot — JSON parsed from helper's stdout>,
  "anchor": "<slugified H2 text — lowercase, hyphens for spaces>"
}
```

Section split rules (preserved):
- **Pre-H2 content** (intro paragraphs after H1): one block, `anchor` omitted (or set to `"intro"` if any tenants want a stable in-page anchor).
- **No H2s at all** (page is just H1 + body): one block with the whole post-H1 body, `anchor` omitted.

Slugification: `originalH2Text.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')` — matches typical CMS-style anchor convention. Idempotent on already-slug values.

### 4.3 `payload-seeder.md` step 5 — page POST body restructure

**Current POST body** (line 119-129):
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
```

**New POST body:**
```bash
PAGE_BODY=$(jq -n \
  --arg tid "${TENANT_ID}" \
  --arg slug "${SLUG}" \
  --arg title "${TITLE}" \
  --arg seoTitle "${SEO_TITLE:-${TITLE}}" \
  --arg desc "${DESCRIPTION:-}" \
  --arg ogImage "${OG_IMAGE:-}" \
  --argjson blocks "${BLOCKS_JSON_ARRAY}" \
  '{
    tenant: $tid,
    slug: $slug,
    title: $title,
    status: "published",
    blocks: $blocks,
    seo: (
      {title: $seoTitle}
      + (if $desc | length > 0 then {description: $desc} else {} end)
      + (if $ogImage | length > 0 then {ogImage: $ogImage} else {} end)
    )
  }')
```

Changes:
- `description`, `ogImage` move under `seo` group
- `seo.title` defaults to the page `title` if the markdown frontmatter doesn't have a separate `seoTitle` (most won't — title-as-title is a sensible default)
- Drop `keywords` (no schema field today)
- Drop `role`, `order` (no schema fields today — were intended for the SSR site's nav generation, which is now driven by `siteSettings.navigation` from `siteSettings.ts`)
- Explicit `status: "published"` (per scope decision)

**Markdown frontmatter compatibility:** the seeder still reads `role` and `order` from frontmatter for backwards-compat with the static site's content collection schema, just stops sending them in the POST. If a future Pages collection re-introduces them, the seeder reads are already in place.

### 4.4 `payload-seeder.md` new section — seed `Tenant.siteManifest` (OBS-49)

Inserted as a new top-level section after "What to do" → "siteSettings POST", before "Output contract":

```markdown
## Seed Tenant.siteManifest

After siteSettings POST succeeds, seed the tenant's siteManifest. The
template's `siab-site-orchestrator` Phase 2 generates `siteManifest.json`
at the site repo root by copying the template's `siteManifest.example.json`.

```bash
MANIFEST_PATH="${SITE_REPO}/siteManifest.json"
if [ ! -f "$MANIFEST_PATH" ]; then
  MANIFEST_PATH="${SITE_REPO}/siteManifest.example.json"
fi

if [ -f "$MANIFEST_PATH" ]; then
  MANIFEST_JSON=$(cat "$MANIFEST_PATH")
  BODY=$(jq -n --argjson manifest "$MANIFEST_JSON" '{siteManifest: $manifest}')
  curl -fsS -X PATCH "${PAYLOAD_API_URL}/api/tenants/${TENANT_ID}" \
    -H "Authorization: users API-Key ${PAYLOAD_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$BODY"
  echo "siteManifest set on tenant ${TENANT_ID} from ${MANIFEST_PATH}"
else
  echo "WARN: no siteManifest.json or siteManifest.example.json at site repo root."
  echo "      Tenant will use siab-payload's DEFAULT_MANIFEST."
  echo "      Caveat: DEFAULT_MANIFEST only allows paragraph + h2/h3 + bold/italic;"
  echo "      seeded pages with lists / quotes / dividers will fail validation."
fi
```

The `WARN` branch is non-fatal — seed continues. Surfaces in the report's `## Site manifest` section so operator sees the warning.

### 4.5 `payload-seeder.md` "Body format note" — rewrite

Old (lines 236-240):
> ## Body format note
>
> The `siab-payload` `pages` collection's `richText` block has a plain `textarea` for `body` and the SSR site renders it via `set:html`. **Ship plain HTML** (see step 4 above for the markdown->HTML conversion). Lexical is configured for the global `lexicalEditor` but is not used by the `richText` block.

New:
> ## Body format note
>
> The `siab-payload` `pages` collection's `richText` block has `body` as a `json` field validated against `rtRootSchema` (block variant) by the `validateRichTextOnSave` collection hook. The schema enforces the rt-dom-contract documented at `siab-payload/docs/runbooks/rt-dom-contract.md`. Ship `RtRoot` JSON — never HTML, never markdown text.
>
> The seeder produces RtRoot via `node scripts/md-to-rtroot.mjs` (see step 4). The helper walks the markdown AST + maps tokens to RtNode types per the contract.
>
> If a future schema change reverts `body` to a different type, do NOT retry blindly. Stop and report — orchestrator escalates the schema contract.

### 4.6 `payload-seeder.md` output contract — add `## Site manifest`

Old "Output contract" section ends at the `## Failures` block. Add a new bullet line in the report template:

```markdown
## Site manifest
- siteManifest set on tenant <id> from <path> (or "WARN: not found, using DEFAULT_MANIFEST")
```

Placed between `## Site settings` and `## Failures` in the report shape.

### 4.7 No changes to other files

- `prompt.md` — Phase 4 dispatch instructions don't change; the seeder consumes the same inputs.
- `cms-reviewer.md` — separate spec (folds into `site-converter`).
- `site-converter.md` — separate spec.
- `preflight.md` — no env or pre-flight changes needed.
- `CLAUDE.md` — no change.

## 5. Backwards compatibility

The current `payload-seeder.md` is **actively broken** against current `siab-payload`. There's no live deployment of the broken seeder — `/add-cms` hasn't run since RT v2 landed. So "backwards compatibility" is moot. This is a fix-forward spec.

Existing `prompt.md` Phase 4 dispatch shape (inputs to the seeder) is preserved — orchestrator-level wiring doesn't need to change to absorb this update.

## 6. Risks

- **`marked@^14` token shape differs from prior major versions.** Older `marked` (<v13) had a different token structure. Helper pins `marked@^14.0.0` in its own `package.json`. If orchestrator-level node_modules has a conflicting `marked`, helper's `cd scripts && npm install --silent` resolves to its local version.
- **`scripts/md-to-rtroot.mjs` produces invalid RtRoot for edge-case markdown** (HTML embedded in markdown, complex nested tables, custom marked extensions). Mitigation: helper drops unsupported tokens with stderr warnings; seeder forwards warnings to its report; operator addresses unusable pages manually in Payload admin.
- **`siteManifest.example.json` from a stale template clone** doesn't match current `manifestSchema`. Mitigation: siab-payload's `loadTenantManifest` falls back to `DEFAULT_MANIFEST` on parse failure (per OBS-57 implementation). The PATCH succeeds (Tenant.siteManifest stores the raw JSON), but tenant rendering uses fallback until manifest is fixed. Non-fatal but visible.
- **Operator deletes `siteManifest.json` between site-orch run and payload-orch run.** Mitigation: seeder's fallback to `.example.json` covers this; if both gone, WARN + continue.
- **Pages collection schema drifts further after this spec.** Mitigation: spec includes verification step (Task 0 of the implementation plan: implementer re-reads `siab-payload/src/collections/Pages.ts` to confirm the schema matches this spec's assumptions before starting).

## 7. Acceptance criteria

- [ ] `scripts/md-to-rtroot.mjs` exists at orchestrator root; reads stdin, emits RtRoot JSON to stdout; handles all token types per the mapping table
- [ ] `scripts/package.json` exists with pinned `marked@^14.0.0`
- [ ] `payload-seeder.md` step 4 instructs piping markdown through the helper; block shape is `{blockType: "richText", body: <RtRoot>, anchor: <slug>}`
- [ ] `payload-seeder.md` step 5 page POST: `description`/`ogImage` under `seo` group; `status: "published"`; no `role`/`order`/`keywords` top-level
- [ ] `payload-seeder.md` has a new section seeding `Tenant.siteManifest` via PATCH (reads `siteManifest.json` with `.example.json` fallback + WARN on missing)
- [ ] `payload-seeder.md` "Body format note" rewritten for RtRoot
- [ ] Output contract markdown includes `## Site manifest` section
- [ ] No changes to `prompt.md`, `cms-reviewer.md`, `site-converter.md`, `preflight.md`, `CLAUDE.md`

## 8. Sequencing — what this unblocks

Once this spec lands:
1. **`site-converter` spec** (next big one) — covers the heavy SSR conversion (~7 conversion groups across Astro config, lib/cms.ts, middleware, BaseLayout tenant-theme injection, scripts/build-cms-css.mjs, Dockerfile, /healthz route). cms-reviewer changes fold in here.
2. **amblast + siteinabox migrations** — once both payload-orchestrator subagents are updated, fresh `/add-cms` runs work end-to-end against current siab-payload.

ami-care doesn't need this work — already CMS-ified via direct edits, not via `/add-cms`.
