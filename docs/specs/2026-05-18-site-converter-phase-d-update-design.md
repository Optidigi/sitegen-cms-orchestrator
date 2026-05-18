# site-converter: post-Phase-D contract update

**Status:** Draft for review
**Date:** 2026-05-18
**Backlog (in siab-payload):** `docs/backlog/infra/README.md` — OBS-56 (sister-repo sync), OBS-55 (cms-editor.css orchestrator sync — workaround leg) · `docs/backlog/features/README.md` — OBS-47 (rich-text v2 backport, site-side consumption)
**Depends on:**
- `siab-payload@main` `c699678` (OBS-57 — `Tenant.siteManifest.blocks[]`, per-block `anchor`, `enforceTenantBlockMenu` hook)
- `siab-site-template@main` `ea3abc7` (OBS-56 — RtNodeRenderer, structure-only renderers, role tokens, `siteManifest.example.json`)
- `siab-site-orchestrator@main` `7d1144e` (CMS-ification readiness — Phase 2 produces `siteManifest.json`)
- `siab-payload-orchestrator@main` `aebc4d9` (payload-seeder RT v2 readiness — markdown→RtRoot helper, manifest seeding)

**Blocks:** amblast + siteinabox fresh `/add-cms` migrations

---

## 1. Context

`siab-payload-orchestrator` is the workshop that runs `/add-cms <slug>` to CMS-ify an existing static site. The `site-converter` subagent (Phase 5 of the 10-phase runbook, ~945 lines at `.claude/agents/site-converter.md`) performs the **surgical conversion of the cloned static Astro site into an SSR site** that reads per-tenant JSON from a mounted volume. It runs in 7 commit-per-group passes covering Astro config, CMS reader/types/middleware/healthz, page route rewriting, SEO from CMS, Dockerfile, docker-compose example, and static content collection removal.

**site-converter was written pre-Phase-D**, before Rich Text v2, OBS-57 (per-block anchor + manifest-driven block menu), and OBS-56 (template's structure-only renderers + role tokens). It now produces converted sites that:

- **Crash at runtime** because `src/lib/types.ts` declares all rich-text fields as `string | null` (e.g. `HeroBlock.headline: string`) but the template's cms/* renderers (post-`ea3abc7`) expect `RtRoot`. The dispatcher (`Blocks.astro`) feeds strings into renderers that try to walk `node.children` → `undefined` → likely null-pointer or empty render.
- **Render without tenant theme** because BaseLayout doesn't read `tenant-theme.css` from `CMS_DATA_DIR` at SSR time. The template ships placeholder values for `--font-{title,heading,text}` + `--radius-{sm,md,lg}` role tokens; without injection of the tenant's compiled CSS, deployed sites show the template's placeholder fonts/colors/radii, not the operator-chosen tenant theme.
- **Leave the CMS canvas rendering admin tokens** because the converted site doesn't ship `dist/cms/cms-editor.css` (the file siab-payload's canvas reads via `loadTenantCss.ts`). The OBS-55 workaround (docker-entrypoint copying `/app/dist/cms/*` → `/data/`) isn't auto-generated. Operators editing in admin see admin-shaped tokens instead of tenant tokens.

amblast + siteinabox haven't been CMS-ified yet (no `/add-cms` run has succeeded since RT v2 landed). Their fresh CMS-ification is blocked until this spec ships.

### Verified against source (claim → file:line evidence)

| Claim | Evidence |
|---|---|
| Converter scaffolds stale block types | `siab-payload-orchestrator/.claude/agents/site-converter.md:118-180` declares all 7 block types with `string`-shaped rich-text fields |
| Current siab-payload schema is RtRoot | `siab-payload/src/blocks/Hero.ts:19,25,31` `type: "json"` for eyebrow/headline/subheadline; same pattern in FeatureList/FAQ/CTA/RichText/ContactSection |
| Current Pages.ts has `seo` group + `status` | `siab-payload/src/collections/Pages.ts:122-126,129-133`; no `role`/`order`/`keywords` fields |
| Template's cms/* renderers consume RtRoot | `siab-site-template/src/components/cms/Hero.tsx:13-25` (post-`ea3abc7`) — props use `RtRoot` for eyebrow/headline/subheadline + optional `anchor` |
| ami-care BaseLayout injects tenant-theme.css | `site-amicare-zorg/src/layouts/BaseLayout.astro` reads `CMS_DATA_DIR/tenant-theme.css` + injects `<style data-tenant-theme>` |
| siab-payload canvas reads dist/cms/cms-editor.css | `siab-payload/src/lib/editor/loadTenantCss.ts` consumes the tenant's compiled CSS via `DATA_DIR/tenants/<id>/cms-editor.css` |
| OBS-55 documents docker-entrypoint workaround | `siab-payload/docs/backlog/infra/README.md` OBS-55 entry |

## 2. Goals

1. **Realign `src/lib/types.ts` template** with current `siab-payload` schemas: all rich-text fields become `RtRoot`; every block gets optional `anchor?: string | null`; Hero gets `pills?: Array<{label: string; id?: string | null}>`; `Page` type gains `seo` group + `status: "draft" | "published"`, drops dead top-level fields (`role`, `order`, `keywords`, top-level `description`/`ogImage`). Add `RtRoot` type definition at top (mirrored from siab-site-template's `src/lib/types.ts`).
2. **Update `src/components/cms/Blocks.astro` dispatcher** template to wire new prop shapes — passes RtRoot values directly, passes `block.anchor`, resolves images via existing `resolveMedia` helper. Per-block dispatch matches template's cms/* renderer prop signatures (post-`ea3abc7`).
3. **`src/layouts/BaseLayout.astro` tenant-theme.css injection** — read `CMS_DATA_DIR/tenant-theme.css` at SSR time (ENOENT silent; other errors logged), inject `<style data-tenant-theme set:html={tenantTheme} />` into `<head>`. Pattern from ami-care reference.
4. **New `scripts/build-cms-css.mjs`** — Node script that compiles the site's `global.css` + `rich-text.css` through Tailwind v4 standalone and writes the output to `dist/cms/cms-editor.css`. Also copies `node_modules/@fontsource-variable/*/files/*.woff2` (any installed font packages) to `dist/cms/files/`. Invoked at build time after `astro build`.
5. **New `scripts/docker-entrypoint.sh`** — OBS-55 immediate workaround. Copies `/app/dist/cms/cms-editor.css` + `/app/dist/cms/files/*` to `/data/` on container start. Silently no-ops if `/data` is read-only or `dist/cms` is absent.
6. **Update Group 5 Dockerfile template** — adds `COPY scripts/docker-entrypoint.sh /usr/local/bin/` + `ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]`. Build step chains `pnpm build && node scripts/build-cms-css.mjs`.
7. **Update Group 6 docker-compose example template** — `/data:rw` instead of `:ro` (required by the entrypoint workaround). Documented as "until OBS-55 proper deploy hook lands, revert to `:ro` then".
8. **Update `cms-reviewer.md` checks** to gate on the new contract: types.ts has `RtRoot` import + correct field shapes per current schemas; Blocks.astro passes RtRoot values; BaseLayout has `tenant-theme.css` injection; `scripts/build-cms-css.mjs` exists + invoked in package.json `build` script; `scripts/docker-entrypoint.sh` present + wired in Dockerfile ENTRYPOINT; compose example uses `/data:rw`.

## 3. Non-goals

- **Dark mode (`data-rt-mode` stamping on `<html>`)** — OBS-38 territory. ami-care reference doesn't include it; matching ami-care = tenant-theme.css injection only.
- **OBS-55 proper orchestrator-level `docker cp` deploy hook** — separate work (operator-level / orchestrator follow-up). The entrypoint we ship is the workaround.
- **`siab-site-template` changes** — already shipped at `ea3abc7`. This spec consumes that shape; doesn't change it.
- **Modifications to site-converter Groups 1, 3, 7** — those don't need updating (Astro config flip, page route rewrite, content collection deletion are all current and correct).
- **`payload-seeder.md` changes** — separate spec shipped at `aebc4d9`.
- **`prompt.md`, `preflight.md`, `CLAUDE.md`** — Phase 5 dispatch shape doesn't change; CLAUDE.md doctrine stays.
- **`auditor.md`** — that's site-orchestrator territory, not payload-orchestrator. Already updated separately.
- **Tests for the converted site's runtime behavior** — site-converter's contract is "produces a buildable + healthy SSR site"; runtime testing is operator-level (Phase 10 of `prompt.md` walks the operator through end-to-end verification).

## 4. Architecture

### 4.1 `.claude/agents/site-converter.md` Group 2 — `src/lib/types.ts` template

Replace the existing block type definitions + Page type (currently around lines 118-200 in site-converter.md). Add an `RtRoot` type at the top.

**Updated template (excerpt — site-converter.md will instruct the converter to Write this whole types.ts file):**

```ts
// src/lib/types.ts — auto-scaffolded shape; mirrors siab-payload/src/blocks/*.ts
// (post-Phase-D + OBS-57) + siab-site-template/src/lib/types.ts (post-OBS-56).

// ---------------------------------------------------------------------------
// Rich Text node types (mirrored from siab-payload/src/lib/richText/RtNode.ts)
// ---------------------------------------------------------------------------
export type RtMark = "bold" | "italic" | "underline" | "code" | "strikethrough"

export interface RtText {
  t: "text"
  v: string
  marks?: RtMark[]
  style?: string
  color?: string
}

export interface RtLink {
  t: "link"
  href: string
  rel?: "external" | "internal"
  children: RtInline[]
}

export interface RtLineBreak { t: "linebreak" }

export type RtInline = RtText | RtLink | RtLineBreak

export type RtAlign = "left" | "center" | "right" | "justify"

export interface RtParagraph  { t: "paragraph"; align?: RtAlign; children: RtInline[] }
export interface RtHeading    { t: "heading"; level: 2 | 3 | 4; align?: RtAlign; style?: string; children: RtInline[] }
export interface RtList       { t: "list"; ordered: boolean; items: RtListItem[] }
export interface RtListItem   { t: "listItem"; children: RtBlock[] }
export interface RtBlockquote { t: "blockquote"; children: RtBlock[] }
export interface RtDivider    { t: "divider" }

export interface RtThemed {
  t: "themed"
  id: string
  props: Record<string, unknown>
  children?: RtBlock[]
}

export type RtBlock =
  | RtParagraph
  | RtHeading
  | RtList
  | RtBlockquote
  | RtDivider
  | RtThemed

export interface RtBlockRoot  { t: "root"; variant: "block";  children: RtBlock[] }
export interface RtInlineRoot { t: "root"; variant: "inline"; children: RtInline[] }
export type RtRoot = RtBlockRoot | RtInlineRoot

// ---------------------------------------------------------------------------
// Media reference (resolved by Blocks.astro via mediaPath/resolveMedia helper)
// ---------------------------------------------------------------------------
export type MediaRef =
  | number
  | string
  | { id: number | string; url?: string | null; filename?: string | null; alt?: string | null }
  | null

// ---------------------------------------------------------------------------
// Block types — mirror siab-payload/src/blocks/*.ts schemas
// ---------------------------------------------------------------------------
export type HeroBlock = {
  blockType: "hero"
  anchor?: string | null
  eyebrow?: RtRoot | null
  headline: RtRoot
  subheadline?: RtRoot | null
  pills?: Array<{ label: string; id?: string | null }>
  cta?: { label?: string | null; href?: string | null } | null
  image?: MediaRef
  imageAlt?: string | null
}

export type FeatureListBlock = {
  blockType: "featureList"
  anchor?: string | null
  title?: RtRoot | null
  intro?: RtRoot | null
  features: Array<{
    title: RtRoot
    description?: RtRoot | null
    icon?: string | null  // kebab-case lucide-preact icon name
  }>
}

export type TestimonialsBlock = {
  blockType: "testimonials"
  anchor?: string | null
  title?: string | null  // plain text (NOT RtRoot)
  items: Array<{
    quote: string  // plain textarea
    author: string
    role?: string | null
    avatar?: MediaRef
  }>
}

export type FAQBlock = {
  blockType: "faq"
  anchor?: string | null
  title?: RtRoot | null
  items: Array<{ question: RtRoot; answer: RtRoot }>
}

export type CTABlock = {
  blockType: "cta"
  anchor?: string | null
  eyebrow?: RtRoot | null
  headline: RtRoot
  description?: RtRoot | null
  primary: { label: string; href: string }  // required group
  secondary?: { label?: string | null; href?: string | null } | null
}

export type RichTextBlock = {
  blockType: "richText"
  anchor?: string | null
  body: RtRoot  // required
}

export type ContactSectionBlock = {
  blockType: "contactSection"
  anchor?: string | null
  title?: RtRoot | null
  description?: RtRoot | null
  formName: string
  fields: Array<{
    name: string
    label: string
    type: "text" | "email" | "tel" | "textarea"
    required?: boolean
  }>
}

export type Block =
  | HeroBlock
  | FeatureListBlock
  | TestimonialsBlock
  | FAQBlock
  | CTABlock
  | RichTextBlock
  | ContactSectionBlock

// ---------------------------------------------------------------------------
// Page + SiteSettings types
// ---------------------------------------------------------------------------
export type Page = {
  id: string
  slug: string
  title: string
  status: "draft" | "published"
  blocks: Block[]
  seo?: {
    title?: string | null
    description?: string | null
    ogImage?: MediaRef | string | null
  }
  updatedAt: string
}

export type NAP = {
  legalName: string
  displayName: string
  street: string
  postalCode: string
  city: string
  country: string
  phone: string
  email: string
}

export type OpeningHours = {
  dayOfWeek: 'Mo' | 'Tu' | 'We' | 'Th' | 'Fr' | 'Sa' | 'Su'
  opens: string
  closes: string
}

export type SiteSettings = {
  brand: string
  language: string
  primaryDomain: string
  aliases: string[]
  description?: string
  nap?: NAP
  hours?: OpeningHours[]
  serviceArea?: string[]
  socials: {
    facebook?: string
    instagram?: string
    linkedin?: string
    youtube?: string
    x?: string
  }
  nav: { label: string; href: string }[]
  updatedAt: string
}
```

The site-converter.md text instructing the agent to `Write` this file gets updated accordingly — the agent writes this whole template into the cloned site's `src/lib/types.ts`.

### 4.2 `.claude/agents/site-converter.md` Group 2 — `src/components/cms/Blocks.astro` template

Update the dispatcher generation. Each block's per-component dispatch must match siab-site-template's cms/* prop signatures (post-OBS-56). Sketch:

```astro
---
import Hero from "./Hero"
import FeatureList from "./FeatureList"
import Testimonials from "./Testimonials"
import FAQ from "./FAQ"
import CTA from "./CTA"
import RichText from "./RichText"
import ContactSection from "./ContactSection"
import { mediaPath } from "../../lib/cms"
import type { Block, MediaRef } from "../../lib/types"

const { blocks = [] } = Astro.props as { blocks: Block[] }

function resolveMedia(ref: MediaRef | undefined): string | null {
  if (!ref) return null
  if (typeof ref === "object" && "url" in ref && ref.url) return mediaPath(ref.url)
  return null
}
---

{blocks.map((block, i) => {
  const dataBlockIndex = i
  switch (block.blockType) {
    case "hero":
      return <Hero
        client:visible
        anchor={block.anchor}
        eyebrow={block.eyebrow}
        headline={block.headline}
        subheadline={block.subheadline}
        pills={block.pills}
        cta={block.cta}
        imageUrl={resolveMedia(block.image)}
        imageAlt={block.imageAlt}
        dataBlockIndex={dataBlockIndex}
      />
    case "featureList":
      return <FeatureList
        client:visible
        anchor={block.anchor}
        title={block.title}
        intro={block.intro}
        features={block.features}
        dataBlockIndex={dataBlockIndex}
      />
    case "testimonials":
      return <Testimonials
        client:visible
        anchor={block.anchor}
        title={block.title}
        items={block.items.map(t => ({
          quote: t.quote,
          author: t.author,
          role: t.role,
          avatarUrl: resolveMedia(t.avatar),
        }))}
        dataBlockIndex={dataBlockIndex}
      />
    case "faq":
      return <FAQ
        client:visible
        anchor={block.anchor}
        title={block.title}
        items={block.items}
        dataBlockIndex={dataBlockIndex}
      />
    case "cta":
      return <CTA
        client:visible
        anchor={block.anchor}
        eyebrow={block.eyebrow}
        headline={block.headline}
        description={block.description}
        primary={block.primary}
        secondary={block.secondary}
        dataBlockIndex={dataBlockIndex}
      />
    case "richText":
      return <RichText
        client:visible
        anchor={block.anchor}
        body={block.body}
        dataBlockIndex={dataBlockIndex}
      />
    case "contactSection":
      return <ContactSection
        client:visible
        anchor={block.anchor}
        title={block.title}
        description={block.description}
        formName={block.formName}
        fields={block.fields}
        dataBlockIndex={dataBlockIndex}
      />
  }
  return null
})}
```

Key per-block notes the site-converter.md must capture:
- **Hero**: pass `imageUrl` (resolved from `block.image` via `resolveMedia`); pass `pills` as array (not stringified)
- **Testimonials**: map `items[].avatar` → `avatarUrl` in the dispatch (per template's TestimonialsProps shape)
- **CTA**: `primary` is required `{label: string; href: string}` (not nullable); `secondary` optional
- **All blocks**: pass `block.anchor` (template stamps `id={anchor || undefined}` or legacy fallback)

### 4.3 `.claude/agents/site-converter.md` Group 4 — `src/layouts/BaseLayout.astro` tenant-theme injection

Group 4 currently instructs the converter to update BaseLayout for SEO sourcing from CMS. Append a tenant-theme.css injection step.

site-converter.md adds:

```astro
---
import { promises as fs } from 'node:fs';
import path from 'node:path';
// ... existing imports ...

const _cmsDataDir = process.env.CMS_DATA_DIR;
let tenantTheme = "";
if (_cmsDataDir) {
  try {
    tenantTheme = await fs.readFile(path.resolve(_cmsDataDir, "tenant-theme.css"), "utf-8");
  } catch (e: any) {
    if (e?.code !== "ENOENT") console.error("[tenant-theme]", e);
  }
}
---

<!doctype html>
<html lang={site?.language ?? 'en'}>
  <head>
    <!-- existing meta + Seo + JsonLd tags ... -->
    {tenantTheme && <style data-tenant-theme set:html={tenantTheme} />}
  </head>
  <body><slot /></body>
</html>
```

Rules captured in the agent:
- Injection placed **after** SEO + JsonLd tags (so a tenant-theme rule can override admin/template token defaults via CSS cascade)
- ENOENT (missing `tenant-theme.css` file) → silent (no console.warn) — tenant just hasn't seeded their compiled CSS yet
- Any other read error → `console.error` (so operators see "Payload wrote garbage" vs "no theme yet")
- The `set:html` is operator-trusted content (the tenant compiled their own CSS via `scripts/build-cms-css.mjs`)

### 4.4 New `scripts/build-cms-css.mjs` (created by site-converter at the converted site's root)

The site-converter.md gets a new sub-section appended to Group 2 (after the existing "media route" + "Blocks.astro" steps, before Group 3 starts). The agent emits this script as part of Group 2's commit.

Helper script content the converter writes:

```js
#!/usr/bin/env node
// Compile the site's global.css + rich-text.css through Tailwind v4 standalone
// to produce dist/cms/cms-editor.css (consumed by siab-payload's canvas via
// loadTenantCss.ts). Also copies @fontsource woff2 files to dist/cms/files/.
// Runs after `astro build`.

import { execSync } from "node:child_process"
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const OUT_DIR = resolve(ROOT, "dist/cms")
const OUT_CSS = resolve(OUT_DIR, "cms-editor.css")
const OUT_FILES = resolve(OUT_DIR, "files")

mkdirSync(OUT_DIR, { recursive: true })

// Compile Tailwind from global.css (which imports rich-text.css). Uses the
// site's tailwindcss dep — same version Astro's vite plugin uses for the
// main build.
execSync(`npx --yes tailwindcss -i src/styles/global.css -o ${OUT_CSS}`, {
  stdio: "inherit",
  cwd: ROOT,
})

// Copy @fontsource-variable woff2 files (if any installed) to dist/cms/files/
const fontsRoot = resolve(ROOT, "node_modules/@fontsource-variable")
if (existsSync(fontsRoot)) {
  mkdirSync(OUT_FILES, { recursive: true })
  for (const family of readdirSync(fontsRoot)) {
    const filesDir = resolve(fontsRoot, family, "files")
    if (!existsSync(filesDir)) continue
    for (const file of readdirSync(filesDir)) {
      if (!file.endsWith(".woff2")) continue
      copyFileSync(resolve(filesDir, file), resolve(OUT_FILES, file))
    }
  }
}

console.log(`[build-cms-css] wrote ${OUT_CSS} and ${OUT_FILES}/*.woff2`)
```

site-converter.md instructs the agent to update `package.json` `scripts.build` to chain the call:

```json
{
  "scripts": {
    "build": "astro build && node scripts/build-cms-css.mjs"
  }
}
```

### 4.5 New `scripts/docker-entrypoint.sh` (created by site-converter)

Generated by the converter with verbatim content:

```sh
#!/bin/sh
# OBS-55 immediate workaround: sync /app/dist/cms/* into /data on container
# start so siab-payload's canvas finds the tenant-compiled CSS. Requires
# /data to be mounted :rw (compose example reflects this). When the proper
# orchestrator-level docker cp deploy hook lands per OBS-55, this entrypoint
# becomes inert and the compose mount can revert to :ro.
set -e

if [ -w /data ] && [ -d /app/dist/cms ]; then
  cp -f /app/dist/cms/cms-editor.css /data/cms-editor.css 2>/dev/null || true
  if [ -d /app/dist/cms/files ]; then
    mkdir -p /data/files
    cp -rf /app/dist/cms/files/. /data/files/ 2>/dev/null || true
  fi
  echo "[entrypoint] cms-editor.css + fonts synced to /data"
else
  echo "[entrypoint] /data not writable or no dist/cms — skipping CMS artifact sync"
fi

exec "$@"
```

Marked executable via `chmod +x scripts/docker-entrypoint.sh` (the converter runs this after Write).

### 4.6 `.claude/agents/site-converter.md` Group 5 — Dockerfile updates

The existing Group 5 Dockerfile template (lines 731-790 of site-converter.md) gets these additions in the final stage:

```dockerfile
# (existing copy lines + pnpm install --prod)

# OBS-55 entrypoint workaround
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "./dist/server/entry.mjs"]
```

The build stage stays unchanged structurally — but the build invocation now naturally runs `node scripts/build-cms-css.mjs` because `package.json` `build` script (per 4.4) chains it.

### 4.7 `.claude/agents/site-converter.md` Group 6 — compose example update

The compose snippet template's mount line changes from `:ro` → `:rw`:

```yaml
services:
  site-<slug>:
    image: ghcr.io/optidigi/site-<slug>:latest
    restart: unless-stopped
    volumes:
      - <vps-data-path>:/data:rw   # WORKAROUND: was :ro; OBS-55 entrypoint needs write
    environment:
      CMS_DATA_DIR: /data
      SITE_URL: https://<primaryDomain>
```

With a comment marker so the operator understands the temporary nature.

### 4.8 `.claude/agents/cms-reviewer.md` updates

Add 6 new checks to cms-reviewer's existing checklist:

1. **types.ts has `RtRoot` import + correct shapes**:
   ```bash
   grep -q "RtRoot" src/lib/types.ts && echo OK || echo BLOCKING
   grep -q "headline: RtRoot" src/lib/types.ts && echo OK || echo BLOCKING
   grep -q "anchor?: string" src/lib/types.ts && echo OK || echo BLOCKING
   ```
2. **Blocks.astro dispatcher passes RtRoot directly + resolves media**:
   ```bash
   grep -q "headline={block.headline}" src/components/cms/Blocks.astro && echo OK || echo BLOCKING
   grep -q "imageUrl={resolveMedia" src/components/cms/Blocks.astro && echo OK || echo BLOCKING
   ```
3. **BaseLayout has tenant-theme.css injection**:
   ```bash
   grep -q "tenant-theme.css" src/layouts/BaseLayout.astro && echo OK || echo BLOCKING
   ```
4. **scripts/build-cms-css.mjs exists + invoked in package.json**:
   ```bash
   test -f scripts/build-cms-css.mjs && echo OK || echo BLOCKING
   grep -q "build-cms-css.mjs" package.json && echo OK || echo BLOCKING
   ```
5. **scripts/docker-entrypoint.sh exists + wired in Dockerfile**:
   ```bash
   test -f scripts/docker-entrypoint.sh && echo OK || echo BLOCKING
   grep -q "ENTRYPOINT.*docker-entrypoint.sh" Dockerfile && echo OK || echo BLOCKING
   ```
6. **compose example uses `/data:rw`**:
   ```bash
   grep -q "/data:rw" docker-compose.cms.yml.example && echo OK || echo BLOCKING
   ```

Existing checks (SSR completeness, defensive rendering, security headers, healthz, no leftover content collection refs) remain.

## 5. Backwards compatibility

site-converter currently doesn't work end-to-end against post-Phase-D `siab-payload`. No live deployments are tracking the broken converter shape — amblast + siteinabox haven't run `/add-cms` since RT v2 landed. Same "fix-forward" framing as the payload-seeder spec.

Sites previously CMS-ified by older versions of this converter (none in production yet — ami-care was direct-edit converted, not via this orchestrator) are out of scope. The orchestrator's CLAUDE.md doctrine explicitly states existing CMS-ifications require "revert + delete tenant + re-run /add-cms" for upgrades.

## 6. Risks

- **`scripts/build-cms-css.mjs` Tailwind invocation** — uses `npx --yes tailwindcss` which resolves the site's `tailwindcss` dep. If the site doesn't have `tailwindcss` (unlikely — siab-site-template ships it), the script fails. Mitigation: the cms-reviewer's existing dependency drift check catches missing `tailwindcss` separately.
- **Tailwind v4 standalone CLI output format** — Tailwind v4's standalone CLI is relatively new; output format could change. Mitigation: site-converter generates a Node script (not a shell pipe), so changes are addressable via script edits without re-running the converter.
- **`@fontsource-variable` font copy step skips silently** if no fonts installed — acceptable per spec (theme defaults apply).
- **BaseLayout `set:html={tenantTheme}` is operator-trusted** content. Tenant compiled their own CSS via `build-cms-css.mjs`; no untrusted input flows through. Same security posture as the rest of the SSR site.
- **/data:rw mount widens permission** compared to :ro. The site image's process has write access to the tenant data dir. Mitigation: documented as workaround; OBS-55's proper deploy hook (operator-level docker cp) reverts to :ro.
- **`scripts/docker-entrypoint.sh` runs unconditionally on every container start.** Restart loops would re-copy CSS — idempotent, harmless. If `dist/cms/cms-editor.css` is older than `/data/cms-editor.css` (e.g. operator manually edited the latter), the entrypoint clobbers the manual edit. Mitigation: documented; operators shouldn't manually edit `/data/cms-editor.css` (it's a generated artifact).
- **types.ts mirror drift from siab-payload schemas** — same risk as siab-site-template's `src/lib/types.ts`. Mitigation: cms-reviewer checks key field shapes; full reconciliation is operator-level.

## 7. Acceptance criteria

- [ ] site-converter.md Group 2 `src/lib/types.ts` template: contains RtRoot + 7 block types with correct shapes per current siab-payload schema; all blocks have optional `anchor`; Hero has `pills`; Page has `seo` group + `status`, no dead top-level fields; SiteSettings unchanged from current (already-aligned)
- [ ] site-converter.md Group 2 `src/components/cms/Blocks.astro` template: dispatcher passes RtRoot values directly; passes `block.anchor`; resolves Hero `imageUrl` + Testimonials `avatarUrl` via `resolveMedia`; per-block dispatch matches template's cms/* prop signatures
- [ ] site-converter.md Group 4 BaseLayout: instructs converter to add `tenant-theme.css` read + `<style data-tenant-theme set:html={tenantTheme} />` injection (ENOENT silent; other errors console.error)
- [ ] site-converter.md gains a new section instructing the converter to Write `scripts/build-cms-css.mjs` + update package.json `build` script
- [ ] site-converter.md gains a new section instructing the converter to Write `scripts/docker-entrypoint.sh` + `chmod +x`
- [ ] site-converter.md Group 5 Dockerfile template: `COPY scripts/docker-entrypoint.sh` + `RUN chmod +x` + `ENTRYPOINT [".../docker-entrypoint.sh"]`
- [ ] site-converter.md Group 6 compose example template: `/data:rw` (with comment marker)
- [ ] cms-reviewer.md: 6 new checks added (types.ts shape, Blocks.astro wiring, BaseLayout injection, build-cms-css.mjs, docker-entrypoint.sh, compose mount mode)
- [ ] No changes to site-converter.md Groups 1, 3, 7
- [ ] No changes to prompt.md, preflight.md, CLAUDE.md, payload-seeder.md, or auditor.md (auditor.md is in site-orchestrator)

## 8. Sequencing — what this unblocks

Once this spec lands:
1. **amblast `/add-cms` migration** — fresh CMS-ification works end-to-end (payload-seeder produces correct seed data; site-converter produces a runtime-correct + theme-aware site).
2. **siteinabox `/add-cms` migration** — same shape.
3. **OBS-55 proper orchestrator deploy hook** (separate future spec) — replaces the docker-entrypoint workaround with operator-level `docker cp` step; compose mount reverts to `:ro`.
4. **OBS-38 dark mode** (separate future spec) — adds `data-rt-mode` stamping on `<html>` (template's CSS rules already exist post-OBS-56; converter's BaseLayout would gain a one-line stamp).

After amblast + siteinabox migrations, the OBS-56 program is complete. The remaining backlog items (OBS-38, OBS-55 proper, OBS-39 destructive-surface token, OBS-36 popover+collapsible) are smaller follow-ups, each their own spec.
