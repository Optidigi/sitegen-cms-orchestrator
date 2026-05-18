# site-converter post-Phase-D contract update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `.claude/agents/site-converter.md` to produce post-Phase-D-correct converted sites + update `.claude/agents/cms-reviewer.md` to gate on the new contract.

**Architecture:** 8 surgical edits to `site-converter.md` (replace stale types.ts template, replace stale Blocks.astro dispatcher template, add 2 new helper-script generation sections, update BaseLayout patching instructions, update Dockerfile template, update compose example) + 6 new gate checks in `cms-reviewer.md`. No code, no tests, no deps — both subagents are prompt-format markdown.

**Tech Stack:** Markdown only.

**Spec:** `docs/specs/2026-05-18-site-converter-phase-d-update-design.md`

---

## Prerequisites

```bash
cd /home/shimmy/Desktop/env/siab/siab-payload-orchestrator
git status   # confirm on feat/site-converter-phase-d-update branch, clean working tree
wc -l .claude/agents/site-converter.md   # confirm baseline 945 lines (will grow ~250 lines after this plan)
wc -l .claude/agents/cms-reviewer.md     # confirm baseline 176 lines
```

If branch/tree state diverges, fix before proceeding.

**Section landmarks for the site-converter.md edits** (re-grep before each task in case prior tasks shifted line numbers):

```bash
grep -n "^### Group" .claude/agents/site-converter.md
```

Baseline (pre-plan):
- Group 1: line 21
- Group 2: line 100
- Group 3: line 531
- Group 4: line 615
- Group 5: line 731
- Group 6: line 791
- Group 7: line 861

---

## Task 1: Group 2 — replace stale types.ts template

**Files:**
- Modify: `.claude/agents/site-converter.md` (Group 2's `Create src/lib/types.ts:` code block, around lines 102-200)

- [ ] **Step 1: Locate exact boundaries**

```bash
grep -n "Create .src/lib/types\.ts" .claude/agents/site-converter.md
grep -n "^Create .src/lib/cms\.ts" .claude/agents/site-converter.md
```

Expected output: line numbers for the start of each "Create" sentence. The types.ts code block runs from immediately after the first match through to immediately before the second match.

- [ ] **Step 2: Apply the replacement**

Use Edit tool. The `old_string` is the entire current types.ts code block. Read the section first via:

```bash
sed -n '102,200p' .claude/agents/site-converter.md
```

(Adjust line range based on Step 1 grep output.)

**Replace the entire `Create src/lib/types.ts:` instruction + the code block that follows it** (everything from the line `Create \`src/lib/types.ts\`:` through the closing ` ``` ` of the types.ts code block) with the new content below. The closing ` ``` ` is immediately before `Create \`src/lib/cms.ts\`:` — that line stays put.

**new_string** (the agent instruction + the new code block):

````
Create `src/lib/types.ts`:

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
    icon?: string | null
  }>
}

export type TestimonialsBlock = {
  blockType: "testimonials"
  anchor?: string | null
  title?: string | null
  items: Array<{
    quote: string
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
  primary: { label: string; href: string }
  secondary?: { label?: string | null; href?: string | null } | null
}

export type RichTextBlock = {
  blockType: "richText"
  anchor?: string | null
  body: RtRoot
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
````

- [ ] **Step 3: Verify**

```bash
grep -n "RtRoot" .claude/agents/site-converter.md | head -5
grep -c "anchor?: string | null" .claude/agents/site-converter.md
grep -c "status: .draft. | .published." .claude/agents/site-converter.md
grep -c "role: 'home' | 'about'" .claude/agents/site-converter.md
```

Expected:
- First grep returns multiple line numbers (RtRoot type definitions + per-block usages)
- Second grep returns at least 7 (anchor on every block)
- Third grep returns at least 1 (Page.status)
- Fourth grep returns 0 (old role field removed)

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): types.ts template aligned with current schemas

Replaces the stale all-string block-field shapes with RtRoot per
siab-payload's current schema. All 7 blocks gain optional anchor.
Hero gains pills. Page type gains seo group + status, drops dead
top-level role/order/keywords/description/ogImage. RtRoot mirror
added at top.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Group 2 — replace stale Blocks.astro template

**Files:**
- Modify: `.claude/agents/site-converter.md` (Group 2's `Create src/components/cms/Blocks.astro` section)

- [ ] **Step 1: Locate boundaries**

```bash
grep -n "Create .src/components/cms/Blocks\.astro" .claude/agents/site-converter.md
grep -n "^### Group 3" .claude/agents/site-converter.md
```

The Blocks.astro section starts at the first match and ends before Group 3. There are intermediate paragraphs describing the dispatcher rationale (`This file dispatches all 7 block types...`) — they should be PRESERVED. The code block within the section is what gets replaced.

- [ ] **Step 2: Read the current section to identify the code-block boundaries**

```bash
sed -n '383,530p' .claude/agents/site-converter.md
```

(Adjust line range based on Step 1.) Identify the `\`\`\`astro` opening fence + the matching closing fence of the Blocks.astro code block. The prose paragraphs around it stay.

- [ ] **Step 3: Apply the replacement**

Use Edit tool to swap ONLY the Blocks.astro code block (between the fences). Preserve the surrounding agent prose.

**new_string for the code block** (between ` ```astro` and the closing ` ``` `):

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

- [ ] **Step 4: Verify**

```bash
grep -n "imageUrl={resolveMedia" .claude/agents/site-converter.md
grep -n "anchor={block.anchor}" .claude/agents/site-converter.md
grep -n "avatarUrl: resolveMedia" .claude/agents/site-converter.md
```

Expected: all three return line numbers (new wiring present). Per-block dispatch matches the template's cms/* prop signatures.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): Blocks.astro dispatcher matches post-OBS-56 cms/* shapes

Per-block dispatch now passes RtRoot values directly (no string
coercion), forwards block.anchor, resolves Hero imageUrl + Testimonials
avatarUrl via resolveMedia. CTA.primary is required group; secondary
optional. Matches siab-site-template's cms/* prop signatures post-ea3abc7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Group 2 — append scripts/build-cms-css.mjs generation sub-section

**Files:**
- Modify: `.claude/agents/site-converter.md` (append a new sub-section to Group 2, after Blocks.astro section ends, before Group 3 starts)

- [ ] **Step 1: Locate the insertion point**

```bash
grep -n "^### Group 3" .claude/agents/site-converter.md
```

The new sub-section goes IMMEDIATELY BEFORE the `### Group 3` line. There's typically a `---` separator above each Group heading — insert before the separator.

- [ ] **Step 2: Read the surrounding context**

```bash
# Read 15 lines before Group 3 to see the current Group 2 ending
GROUP3_LINE=$(grep -n "^### Group 3" .claude/agents/site-converter.md | head -1 | cut -d: -f1)
sed -n "$((GROUP3_LINE - 15)),$((GROUP3_LINE - 1))p" .claude/agents/site-converter.md
```

Identify the `---` separator (or whatever sits between Group 2 and Group 3). The new content goes between Group 2's final block and that separator.

- [ ] **Step 3: Apply the edit**

Use Edit tool. Match the exact text that sits between Group 2's final paragraph and the `---` + Group 3 heading. Append the new sub-section after Group 2's final content + before the `---`.

Most likely Edit shape:

**old_string**: (the LAST sentence/paragraph of Group 2 — likely the verification + commit blob for the existing Group 2 content; identify via Step 2's sed)

**new_string**: that same final content + the new sub-section appended below.

The sub-section to append:

````
Create `scripts/build-cms-css.mjs` (Node helper that compiles tenant theme CSS at build time, producing `dist/cms/cms-editor.css` for siab-payload's canvas to consume via `loadTenantCss.ts`):

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

Update `package.json` to chain this after `astro build`:

```bash
node -e '
const pkg = require("./package.json")
pkg.scripts ||= {}
pkg.scripts.build = "astro build && node scripts/build-cms-css.mjs"
require("fs").writeFileSync("./package.json", JSON.stringify(pkg, null, 2) + "\n")
'
```

Verify:
```bash
test -f scripts/build-cms-css.mjs && echo OK
grep -q "build-cms-css.mjs" package.json && echo OK
```

Commit:
```bash
git add scripts/build-cms-css.mjs package.json
git commit -m "feat: add scripts/build-cms-css.mjs for tenant CSS compilation"
```

````

- [ ] **Step 4: Verify**

```bash
grep -n "scripts/build-cms-css.mjs" .claude/agents/site-converter.md
```

Expected: line numbers (the new section is in place).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): add scripts/build-cms-css.mjs generation in Group 2

New sub-section instructs the agent to Write a Node helper that compiles
tenant theme tokens into dist/cms/cms-editor.css at build time. The file
is what siab-payload's canvas reads to render with tenant tokens via
loadTenantCss.ts. Mirrors ami-care's scripts/build-cms-css.mjs pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Group 2 — append scripts/docker-entrypoint.sh generation sub-section

**Files:**
- Modify: `.claude/agents/site-converter.md` (append a second new sub-section after Task 3's build-cms-css.mjs sub-section)

- [ ] **Step 1: Locate the insertion point**

After Task 3, the build-cms-css.mjs sub-section ends with its own commit instructions. The new docker-entrypoint sub-section goes immediately after that, still before the `---` + Group 3 heading.

```bash
grep -n "scripts/build-cms-css.mjs" .claude/agents/site-converter.md
grep -n "^### Group 3" .claude/agents/site-converter.md
```

Insert between Task 3's sub-section + the `---` + Group 3.

- [ ] **Step 2: Apply the edit**

Use Edit tool. The `old_string` is the commit block from Task 3 (`git commit -m "feat: add scripts/build-cms-css.mjs for tenant CSS compilation"`) through whatever follows it before the `---` separator. Append the new sub-section after.

The sub-section to append:

````
Create `scripts/docker-entrypoint.sh` (OBS-55 immediate workaround — copies `/app/dist/cms/*` into `/data/` on container start so siab-payload's canvas finds tenant-compiled CSS at the expected path):

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

Mark it executable:

```bash
chmod +x scripts/docker-entrypoint.sh
```

Verify:
```bash
test -x scripts/docker-entrypoint.sh && echo OK
head -1 scripts/docker-entrypoint.sh | grep -q "^#!/bin/sh" && echo OK
```

Commit:
```bash
git add scripts/docker-entrypoint.sh
git commit -m "feat: add scripts/docker-entrypoint.sh OBS-55 workaround"
```

````

- [ ] **Step 3: Verify**

```bash
grep -n "scripts/docker-entrypoint.sh" .claude/agents/site-converter.md
```

Expected: line numbers (multiple — the section header + the in-section references).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): add scripts/docker-entrypoint.sh generation in Group 2

OBS-55 immediate workaround section: agent Writes a shell entrypoint
that copies /app/dist/cms/* into /data on container start. Requires
/data:rw mount (compose example updated in Task 7). Inert when /data
is read-only or dist/cms is absent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Group 4 — append BaseLayout tenant-theme.css injection step

**Files:**
- Modify: `.claude/agents/site-converter.md` (Group 4, after the existing BaseLayout-from-CMS instructions)

- [ ] **Step 1: Locate the Group 4 BaseLayout section**

```bash
grep -n "^### Group 4\|BaseLayout\.astro" .claude/agents/site-converter.md | head -20
```

Group 4 starts at line 615 (or wherever current). Identify where the BaseLayout patching instructions end.

- [ ] **Step 2: Read Group 4 to identify the right insertion point**

```bash
GROUP4_LINE=$(grep -n "^### Group 4" .claude/agents/site-converter.md | head -1 | cut -d: -f1)
GROUP5_LINE=$(grep -n "^### Group 5" .claude/agents/site-converter.md | head -1 | cut -d: -f1)
sed -n "${GROUP4_LINE},${GROUP5_LINE}p" .claude/agents/site-converter.md
```

Find Group 4's existing commit block (last item before `---` + Group 5). The new step goes BEFORE that commit block — so the tenant-theme injection lands in the same commit as the rest of Group 4's BaseLayout edits.

- [ ] **Step 3: Apply the edit**

Use Edit tool. Insert a new sub-step immediately before Group 4's commit block.

The new sub-step to insert:

````
After the SEO + JsonLd injections, add the tenant-theme.css read + injection at the END of `<head>` (so a tenant-theme rule overrides admin/template token defaults via CSS cascade):

Read the current `src/layouts/BaseLayout.astro`. In the frontmatter (between `---` fences), add the imports + the async read:

```astro
import { promises as fs } from 'node:fs';
import path from 'node:path';
// ... existing imports preserved ...

const _cmsDataDir = process.env.CMS_DATA_DIR;
let tenantTheme = "";
if (_cmsDataDir) {
  try {
    tenantTheme = await fs.readFile(path.resolve(_cmsDataDir, "tenant-theme.css"), "utf-8");
  } catch (e: any) {
    // ENOENT is the expected "tenant hasn't seeded their CSS yet" path — silent.
    // Any other read error is unexpected — log so operators see "Payload wrote
    // garbage" vs "no theme yet".
    if (e?.code !== "ENOENT") console.error("[tenant-theme]", e);
  }
}
```

In the `<head>` block (AFTER existing Seo + JsonLd tags), add:

```astro
{tenantTheme && <style data-tenant-theme set:html={tenantTheme} />}
```

The `set:html` is operator-trusted content (the tenant compiled their own CSS via `scripts/build-cms-css.mjs` — see Task 3 of the spec).

Verify:
```bash
grep -q "tenant-theme.css" src/layouts/BaseLayout.astro && echo OK
grep -q "data-tenant-theme" src/layouts/BaseLayout.astro && echo OK
```

````

- [ ] **Step 4: Verify**

```bash
grep -n "tenant-theme.css" .claude/agents/site-converter.md
grep -n "data-tenant-theme" .claude/agents/site-converter.md
```

Expected: both return line numbers (multiple — the instruction prose + the code examples).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): BaseLayout reads + injects tenant-theme.css at SSR

Group 4 now instructs the agent to add a tenant-theme.css read from
CMS_DATA_DIR + injection as <style data-tenant-theme> in <head>.
ENOENT is silent (tenant hasn't seeded CSS yet); other read errors
log to console. Mirror of ami-care's BaseLayout pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Group 5 — Dockerfile template updates

**Files:**
- Modify: `.claude/agents/site-converter.md` (Group 5 Dockerfile final stage template, around lines 731-790)

- [ ] **Step 1: Read the current Dockerfile template**

```bash
GROUP5_LINE=$(grep -n "^### Group 5" .claude/agents/site-converter.md | head -1 | cut -d: -f1)
GROUP6_LINE=$(grep -n "^### Group 6" .claude/agents/site-converter.md | head -1 | cut -d: -f1)
sed -n "${GROUP5_LINE},${GROUP6_LINE}p" .claude/agents/site-converter.md
```

- [ ] **Step 2: Apply the edit**

Find the Dockerfile code block's final stage (after `pnpm install --prod`). Use Edit tool to add the entrypoint COPY + ENTRYPOINT lines.

**old_string** (the existing tail of the Dockerfile template — the lines from `EXPOSE 4321` through `CMD ["node", "./dist/server/entry.mjs"]`):

```dockerfile
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz >/dev/null || exit 1

CMD ["node", "./dist/server/entry.mjs"]
```

**new_string**:

```dockerfile
# OBS-55 entrypoint workaround — copy dist/cms/* into /data on start.
# Becomes inert when proper orchestrator deploy hook lands per OBS-55.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "./dist/server/entry.mjs"]
```

If the exact `old_string` doesn't match (the existing template might have slightly different formatting), grep first to find the exact text:

```bash
grep -n "EXPOSE 4321\|HEALTHCHECK\|CMD ..node" .claude/agents/site-converter.md
sed -n '<that block range>p' .claude/agents/site-converter.md
```

Then build the exact `old_string` from what's there + apply Edit.

- [ ] **Step 3: Verify**

```bash
grep -n "COPY scripts/docker-entrypoint.sh" .claude/agents/site-converter.md
grep -n "ENTRYPOINT.*docker-entrypoint.sh" .claude/agents/site-converter.md
```

Expected: both return line numbers.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): Group 5 Dockerfile copies + wires entrypoint

Adds COPY scripts/docker-entrypoint.sh + chmod + ENTRYPOINT to the
Dockerfile template. CMD stays the same (Astro server entry). Build
step naturally chains scripts/build-cms-css.mjs via package.json
build script (updated in Task 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Group 6 — compose example /data:rw + README note

**Files:**
- Modify: `.claude/agents/site-converter.md` (Group 6 compose example template, around line 809)

- [ ] **Step 1: Locate the existing `/data:ro` line**

```bash
grep -n "/data:ro" .claude/agents/site-converter.md
```

Expected: 1-2 hits (the compose example template + maybe a README-note mention).

- [ ] **Step 2: Apply the edit**

Use Edit tool with `replace_all: false`, surgical edit per hit.

For the compose example template:

**old_string**:
```
      - <vps-data-path>:/data:ro
```

**new_string**:
```
      - <vps-data-path>:/data:rw   # OBS-55 workaround: was :ro; entrypoint needs write. Revert to :ro when proper orchestrator-level docker cp deploy hook lands per OBS-55.
```

If there's a second `/data:ro` mention (e.g. in the README note section), update it similarly OR remove the `:ro` reference if it's just narrative text saying "mount /data:ro" — replace with `/data:rw` + a brief note about the workaround.

- [ ] **Step 3: Verify**

```bash
grep -c "/data:rw" .claude/agents/site-converter.md
grep -c "/data:ro" .claude/agents/site-converter.md
```

Expected: first returns >=1 (new value present), second returns 0 (old value gone, or only narrative-context survivors).

If the second grep returns >0, inspect each remaining hit:
```bash
grep -B 2 -A 2 "/data:ro" .claude/agents/site-converter.md
```

If any are still incorrect (operative compose example or operator-facing note), Edit them.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/site-converter.md
git commit -m "$(cat <<'EOF'
feat(site-converter): Group 6 compose example uses /data:rw (OBS-55 workaround)

Compose example mount mode changes from :ro to :rw because the entrypoint
(Tasks 4 + 6) needs write access to /data. Comment marker explains the
temporary nature; reverts to :ro when OBS-55 proper deploy hook ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: cms-reviewer.md — add 6 new gate checks

**Files:**
- Modify: `.claude/agents/cms-reviewer.md`

- [ ] **Step 1: Locate the existing "What to check" section**

```bash
grep -n "^## What to check\|^### " .claude/agents/cms-reviewer.md | head -10
```

Expected: shows section headers — currently "SSR conversion completeness", "CMS reader and types", etc. The new checks layer into existing sub-sections OR get a new "Post-Phase-D contract" sub-section.

- [ ] **Step 2: Apply the edit**

Use Edit tool. Append a new sub-section after the LAST existing sub-section in "What to check" (typically before "Output format" section).

```bash
grep -n "^### \|^## Output format" .claude/agents/cms-reviewer.md
```

Identify the last `### ` sub-section + the `## Output format` heading. Insert the new sub-section between them.

**new_string** (the new sub-section appended):

````

### Post-Phase-D contract (RtRoot + role tokens + canvas CSS sync)

- **`src/lib/types.ts` declares RtRoot + post-Phase-D block shapes**:
  ```bash
  grep -q "export type RtRoot" src/lib/types.ts && echo OK || echo BLOCKING
  grep -q "headline: RtRoot" src/lib/types.ts && echo OK || echo BLOCKING
  grep -c "anchor?: string | null" src/lib/types.ts | awk '$1 >= 7 { print "OK" } $1 < 7 { print "BLOCKING: expected 7+ anchor declarations, got " $1 }'
  grep -q "status: .draft. | .published." src/lib/types.ts && echo OK || echo BLOCKING
  ```
- **`src/components/cms/Blocks.astro` dispatcher passes RtRoot directly + resolves media**:
  ```bash
  grep -q "headline={block.headline}" src/components/cms/Blocks.astro && echo OK || echo BLOCKING
  grep -q "imageUrl={resolveMedia" src/components/cms/Blocks.astro && echo OK || echo BLOCKING
  grep -q "avatarUrl: resolveMedia" src/components/cms/Blocks.astro && echo OK || echo BLOCKING
  grep -q "anchor={block.anchor}" src/components/cms/Blocks.astro && echo OK || echo BLOCKING
  ```
- **`src/layouts/BaseLayout.astro` injects tenant-theme.css**:
  ```bash
  grep -q "tenant-theme.css" src/layouts/BaseLayout.astro && echo OK || echo BLOCKING
  grep -q "data-tenant-theme" src/layouts/BaseLayout.astro && echo OK || echo BLOCKING
  ```
- **`scripts/build-cms-css.mjs` exists + wired in package.json build**:
  ```bash
  test -f scripts/build-cms-css.mjs && echo OK || echo BLOCKING
  grep -q "build-cms-css.mjs" package.json && echo OK || echo BLOCKING
  ```
- **`scripts/docker-entrypoint.sh` exists + wired in Dockerfile ENTRYPOINT**:
  ```bash
  test -x scripts/docker-entrypoint.sh && echo OK || echo BLOCKING
  grep -q 'ENTRYPOINT.*docker-entrypoint.sh' Dockerfile && echo OK || echo BLOCKING
  ```
- **`docker-compose.cms.yml.example` mounts /data:rw** (per OBS-55 workaround):
  ```bash
  grep -q "/data:rw" docker-compose.cms.yml.example && echo OK || echo BLOCKING
  ```

````

- [ ] **Step 3: Verify**

```bash
grep -n "Post-Phase-D contract" .claude/agents/cms-reviewer.md
grep -c "BLOCKING" .claude/agents/cms-reviewer.md
```

Expected: first returns a line number; second returns >=10 (each new check has a BLOCKING branch).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/cms-reviewer.md
git commit -m "$(cat <<'EOF'
feat(cms-reviewer): gate on post-Phase-D contract — RtRoot + tenant-theme + canvas CSS sync

Adds a new "Post-Phase-D contract" sub-section to the cms-reviewer
What-to-check. Six new gate checks: types.ts shape (RtRoot + anchor
+ status), Blocks.astro dispatch wiring, BaseLayout tenant-theme
injection, scripts/build-cms-css.mjs present + invoked, scripts/
docker-entrypoint.sh present + wired in ENTRYPOINT, compose mount /data:rw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification + close-out

**Files:** No code changes; verification only.

- [ ] **Step 1: Verify all spec areas landed in site-converter.md**

```bash
echo "=== types.ts RtRoot ==="
grep -c "export type RtRoot" .claude/agents/site-converter.md
echo "=== types.ts anchor (>=7 expected) ==="
grep -c "anchor?: string | null" .claude/agents/site-converter.md
echo "=== Blocks.astro imageUrl wiring ==="
grep -n "imageUrl={resolveMedia" .claude/agents/site-converter.md
echo "=== Blocks.astro avatarUrl mapping ==="
grep -n "avatarUrl: resolveMedia" .claude/agents/site-converter.md
echo "=== build-cms-css.mjs sub-section ==="
grep -n "scripts/build-cms-css.mjs" .claude/agents/site-converter.md
echo "=== docker-entrypoint.sh sub-section ==="
grep -n "scripts/docker-entrypoint.sh" .claude/agents/site-converter.md
echo "=== BaseLayout tenant-theme.css instruction ==="
grep -n "tenant-theme.css" .claude/agents/site-converter.md
echo "=== Dockerfile ENTRYPOINT line ==="
grep -n "ENTRYPOINT.*docker-entrypoint.sh" .claude/agents/site-converter.md
echo "=== compose /data:rw ==="
grep -n "/data:rw" .claude/agents/site-converter.md
echo "=== old /data:ro residual? ==="
grep -c "/data:ro" .claude/agents/site-converter.md
echo "=== old stale string-typed block fields? ==="
grep -c "headline: string" .claude/agents/site-converter.md
grep -c "subheadline?: string | null" .claude/agents/site-converter.md
grep -c "body: string$" .claude/agents/site-converter.md
echo "=== old Page.role stale field? ==="
grep -c "role: 'home' | 'about'" .claude/agents/site-converter.md
```

Expected:
- RtRoot: >=1 (type definition present)
- anchor: >=7 (all 7 block types)
- imageUrl/avatarUrl: >=1 each
- All 4 new file references present (build-cms-css, docker-entrypoint, tenant-theme.css, ENTRYPOINT)
- /data:rw: >=1
- /data:ro residual: 0 (or only narrative survivors)
- Old `headline: string` / `subheadline: string | null` / `body: string` count: 0 (replaced with RtRoot)
- Old `role: 'home' | 'about'` count: 0

- [ ] **Step 2: Verify cms-reviewer.md gained the new sub-section**

```bash
grep -n "Post-Phase-D contract" .claude/agents/cms-reviewer.md
grep -c "tenant-theme.css\|docker-entrypoint.sh\|build-cms-css.mjs" .claude/agents/cms-reviewer.md
```

Expected: first returns 1 line; second returns >=3 (each helper referenced in its check block).

- [ ] **Step 3: Verify diff scope is clean**

```bash
git diff main --stat
```

Expected:
- `.claude/agents/site-converter.md` (~250-LOC growth from baseline 945)
- `.claude/agents/cms-reviewer.md` (~30-LOC growth from baseline 176)
- `docs/specs/2026-05-18-site-converter-phase-d-update-design.md` (already committed)
- `docs/plans/2026-05-18-site-converter-phase-d-update-plan.md` (this file — already committed)

No accidental changes to `prompt.md`, `preflight.md`, `CLAUDE.md`, `payload-seeder.md`, `auditor.md` (auditor is site-orchestrator territory anyway).

- [ ] **Step 4: Verify commit count**

```bash
git log --oneline main..HEAD
```

Expected: 10 commits (spec + plan + 8 implementation: Tasks 1-8).

- [ ] **Step 5: No commit needed if all verifications pass**

If any verification fails, identify which task's edit didn't land cleanly, re-do that task's edit, commit with `fix(site-converter): <what>`, and re-run from Step 1.

---

## Done — what got built

After all 9 tasks:

1. **`site-converter.md` Group 2 — types.ts template restructured** with RtRoot for rich-text fields, anchor on every block, Hero pills, Page seo group + status, no dead fields
2. **`site-converter.md` Group 2 — Blocks.astro template restructured** to pass RtRoot directly + resolve media via existing helper
3. **`site-converter.md` Group 2 — new sub-section: scripts/build-cms-css.mjs** generation (Node helper compiles tenant CSS at build time)
4. **`site-converter.md` Group 2 — new sub-section: scripts/docker-entrypoint.sh** generation (OBS-55 workaround copies dist/cms to /data on start)
5. **`site-converter.md` Group 4 — BaseLayout tenant-theme.css injection** step appended
6. **`site-converter.md` Group 5 — Dockerfile COPY + ENTRYPOINT** for the docker-entrypoint.sh
7. **`site-converter.md` Group 6 — compose /data:rw** (OBS-55 workaround)
8. **`cms-reviewer.md` — 6 new gate checks** in a "Post-Phase-D contract" sub-section

**Total estimated effort:** 9 tasks, 5-15 min each ≈ 60-120 min of focused work + verification. The big tasks (1, 2) carry the most content; the rest are small surgical inserts.

**Downstream unlocked:**
- amblast fresh `/add-cms` migration (end-to-end works once this lands + the prior payload-seeder spec at `aebc4d9`)
- siteinabox fresh `/add-cms` migration
- After both: the OBS-56 program is complete; remaining backlog items (OBS-38 dark mode, OBS-55 proper deploy hook, OBS-39 destructive-surface token, OBS-36 popover+collapsible) are smaller follow-ups.
