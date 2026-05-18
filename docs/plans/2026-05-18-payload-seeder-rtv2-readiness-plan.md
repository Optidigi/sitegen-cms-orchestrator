# payload-seeder RT v2 + current-schema readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the actively-broken `payload-seeder` subagent against current `siab-payload`: ship a markdown→RtRoot helper script, correct the rich-text block shape, restructure the page POST body, and seed `Tenant.siteManifest`.

**Architecture:** New `scripts/md-to-rtroot.mjs` Node helper (with its own pinned `marked` dep + `node --test` suite) parses markdown via `marked.lexer()` and emits valid `RtRoot` JSON per `siab-payload/docs/runbooks/rt-dom-contract.md`. `payload-seeder.md` gets 5 surgical edits: step 4 (use helper instead of marked→HTML), step 5 (seo group nesting + drop dead fields + status:published), new siteManifest seeding section, rewritten "Body format note", new "Site manifest" output-contract section.

**Tech Stack:** Node.js (built-in `node --test`), `marked@^14` (pinned in helper's own package.json), Markdown.

**Spec:** `docs/specs/2026-05-18-payload-seeder-rtv2-readiness-design.md`

---

## Prerequisites

```bash
cd /home/shimmy/Desktop/env/siab/siab-payload-orchestrator
git status   # confirm on feat/payload-seeder-rtv2-readiness branch, clean working tree
node --version   # >= 22 (for built-in test runner)
```

If `node` < 22, install via the operator's Node version manager (nvm/asdf/etc).

---

## Task 1: Set up `scripts/` with pinned `marked` dep

**Files:**
- Create: `scripts/package.json`
- Create: `scripts/.gitignore`

- [ ] **Step 1: Create scripts directory + package.json**

```bash
mkdir -p scripts
```

Write `scripts/package.json`:

```json
{
  "name": "siab-payload-orchestrator-scripts",
  "private": true,
  "type": "module",
  "description": "Helper scripts used by payload-orchestrator subagents (notably payload-seeder).",
  "dependencies": {
    "marked": "^14.0.0"
  },
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Add scripts/.gitignore**

Write `scripts/.gitignore`:

```
node_modules/
```

- [ ] **Step 3: Install + lock the marked version**

```bash
cd scripts && npm install --silent && cd ..
ls scripts/package-lock.json   # confirm lockfile created
```

- [ ] **Step 4: Commit**

```bash
git add scripts/package.json scripts/.gitignore scripts/package-lock.json
git commit -m "$(cat <<'EOF'
feat(scripts): set up scripts/ workspace with pinned marked

Isolated scripts/package.json so the helper's marked dep doesn't pollute
the orchestrator's top level (which has no package.json today). Lockfile
pins the exact marked version for reproducibility across orchestrator
runs on different operator machines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement `scripts/md-to-rtroot.mjs` + `node --test` suite

**Files:**
- Create: `scripts/md-to-rtroot.mjs`
- Create: `scripts/md-to-rtroot.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `scripts/md-to-rtroot.test.mjs`:

```js
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HELPER = join(__dirname, "md-to-rtroot.mjs")

function run(md) {
  const result = spawnSync("node", [HELPER], { input: md, encoding: "utf-8" })
  if (result.status !== 0) {
    throw new Error(`helper exited ${result.status}: ${result.stderr}`)
  }
  return JSON.parse(result.stdout)
}

test("emits RtRoot wrapper with block variant", () => {
  const out = run("hello world")
  assert.equal(out.t, "root")
  assert.equal(out.variant, "block")
  assert.ok(Array.isArray(out.children))
})

test("paragraph + text", () => {
  const out = run("hello world")
  assert.equal(out.children.length, 1)
  assert.equal(out.children[0].t, "paragraph")
  assert.equal(out.children[0].children[0].t, "text")
  assert.equal(out.children[0].children[0].v, "hello world")
})

test("heading levels 2-4 mapped, h1 dropped (page-title owns it)", () => {
  const out = run("# top\n## sub\n### subsub\n#### subsubsub")
  const headings = out.children.filter(n => n.t === "heading")
  assert.equal(headings.length, 3)
  assert.deepEqual(headings.map(h => h.level), [2, 3, 4])
})

test("unordered list", () => {
  const out = run("- one\n- two")
  const list = out.children[0]
  assert.equal(list.t, "list")
  assert.equal(list.ordered, false)
  assert.equal(list.items.length, 2)
  assert.equal(list.items[0].t, "listItem")
})

test("ordered list", () => {
  const out = run("1. one\n2. two")
  const list = out.children[0]
  assert.equal(list.t, "list")
  assert.equal(list.ordered, true)
})

test("blockquote wraps inner blocks", () => {
  const out = run("> wisdom")
  assert.equal(out.children[0].t, "blockquote")
})

test("horizontal rule → divider", () => {
  const out = run("---")
  assert.equal(out.children[0].t, "divider")
})

test("bold inline mark", () => {
  const out = run("**bold** text")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("bold")))
})

test("italic inline mark", () => {
  const out = run("*italic*")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("italic")))
})

test("inline code", () => {
  const out = run("`code`")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("code")))
})

test("link with external rel for http href", () => {
  const out = run("[ex](https://example.com)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.href, "https://example.com")
  assert.equal(link.rel, "external")
})

test("link with internal rel for relative href", () => {
  const out = run("[here](/about)")
  const link = out.children[0].children.find(n => n.t === "link")
  assert.equal(link.href, "/about")
  assert.equal(link.rel, "internal")
})

test("strikethrough mark", () => {
  const out = run("~~gone~~")
  const inline = out.children[0].children
  assert.ok(inline.some(n => n.t === "text" && n.marks?.includes("strikethrough")))
})

test("fenced code block → paragraph with code mark", () => {
  const out = run("```\nlet x = 1\n```")
  const para = out.children[0]
  assert.equal(para.t, "paragraph")
  assert.equal(para.children[0].marks?.[0], "code")
})

test("empty input → empty children", () => {
  const out = run("")
  assert.deepEqual(out, { t: "root", variant: "block", children: [] })
})

test("h1 stripped from output (page title owns h1)", () => {
  const out = run("# Page Title\n\nbody text")
  assert.ok(!out.children.some(n => n.t === "heading" && n.level === 1))
})
```

- [ ] **Step 2: Run tests to verify they fail (helper doesn't exist yet)**

```bash
cd scripts && node --test
```

Expected: errors loading `md-to-rtroot.mjs` (file not found). All 16 tests fail at the spawn step.

- [ ] **Step 3: Implement the helper**

Create `scripts/md-to-rtroot.mjs`:

```js
#!/usr/bin/env node
// Read markdown from stdin, emit RtRoot (block variant) JSON to stdout.
// Mapping per siab-payload/docs/runbooks/rt-dom-contract.md.
// Token shape from marked@^14.

import { marked } from "marked"
import { readFileSync } from "node:fs"

const md = readFileSync(0, "utf-8")
const tokens = marked.lexer(md)

function tokensToBlocks(tokens) {
  const out = []
  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        if (t.depth >= 2 && t.depth <= 4) {
          out.push({
            t: "heading",
            level: t.depth,
            children: inlineTokensToRtInline(t.tokens ?? []),
          })
        }
        // h1 dropped (page title owns h1); h5+ not in rt-dom-contract
        break
      case "paragraph":
        out.push({
          t: "paragraph",
          children: inlineTokensToRtInline(t.tokens ?? []),
        })
        break
      case "list":
        out.push({
          t: "list",
          ordered: !!t.ordered,
          items: (t.items ?? []).map(item => ({
            t: "listItem",
            children: tokensToBlocks(item.tokens ?? []),
          })),
        })
        break
      case "blockquote":
        out.push({
          t: "blockquote",
          children: tokensToBlocks(t.tokens ?? []),
        })
        break
      case "hr":
        out.push({ t: "divider" })
        break
      case "code":
        // Fenced code block; RtNode has no block-code type — render inline as fallback.
        out.push({
          t: "paragraph",
          children: [{ t: "text", v: t.text, marks: ["code"] }],
        })
        break
      case "space":
        break  // skip empty lines
      case "html":
      case "table":
        process.stderr.write(`[md-to-rtroot] skipped unsupported token type: ${t.type}\n`)
        break
      default:
        process.stderr.write(`[md-to-rtroot] skipped unknown token type: ${t.type}\n`)
    }
  }
  return out
}

function inlineTokensToRtInline(tokens) {
  const out = []
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        out.push({ t: "text", v: t.text })
        break
      case "strong":
        out.push(...wrapMark(t.tokens ?? [{ type: "text", text: t.text }], "bold"))
        break
      case "em":
        out.push(...wrapMark(t.tokens ?? [{ type: "text", text: t.text }], "italic"))
        break
      case "codespan":
        out.push({ t: "text", v: t.text, marks: ["code"] })
        break
      case "del":
        out.push(...wrapMark(t.tokens ?? [{ type: "text", text: t.text }], "strikethrough"))
        break
      case "link":
        out.push({
          t: "link",
          href: t.href,
          rel: t.href.startsWith("http://") || t.href.startsWith("https://") ? "external" : "internal",
          children: inlineTokensToRtInline(t.tokens ?? [{ type: "text", text: t.text }]),
        })
        break
      case "br":
        out.push({ t: "linebreak" })
        break
      case "image":
        process.stderr.write(`[md-to-rtroot] skipped inline image: ${t.href} (use Hero/FeatureList blocks for images instead)\n`)
        break
      default:
        process.stderr.write(`[md-to-rtroot] skipped unknown inline token: ${t.type}\n`)
    }
  }
  return out
}

function wrapMark(tokens, mark) {
  const inner = inlineTokensToRtInline(tokens)
  return inner.map(n =>
    n.t === "text"
      ? { ...n, marks: [...(n.marks ?? []), mark] }
      : n
  )
}

const rt = {
  t: "root",
  variant: "block",
  children: tokensToBlocks(tokens),
}

process.stdout.write(JSON.stringify(rt))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd scripts && node --test
```

Expected: 16/16 pass.

- [ ] **Step 5: Smoke test against a realistic markdown sample**

```bash
cat <<'MD' | node scripts/md-to-rtroot.mjs | jq .
# Page Title

Some intro text.

## First Section

A paragraph with **bold** and *italic* and [a link](https://example.com).

- Item one
- Item two
MD
```

Expected: well-formed JSON; `t: "root"`, `variant: "block"`, `children` contains paragraph (intro), heading (level 2 "First Section"), paragraph (with mixed inline marks + link), list (unordered with 2 items). No h1 in the output.

- [ ] **Step 6: Commit**

```bash
git add scripts/md-to-rtroot.mjs scripts/md-to-rtroot.test.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): md-to-rtroot.mjs helper + node --test suite

Parses markdown via marked.lexer(), walks the token tree, emits RtRoot
(block variant) JSON per siab-payload/docs/runbooks/rt-dom-contract.md.
H1 is dropped (page title owns it). Unsupported tokens (tables, inline
images, embedded HTML) skipped with stderr warnings. 16 node --test
cases cover all supported node types + edge cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `payload-seeder.md` step 4 — rewrite for MD→RtRoot via helper

**Files:**
- Modify: `.claude/agents/payload-seeder.md` (step 4 of "What to do", currently lines 91-114)

- [ ] **Step 1: Read current step 4 to confirm context**

```bash
sed -n '91,114p' .claude/agents/payload-seeder.md
```

Expected: shows the current H2-split + marked→HTML + `{blockType, heading, body}` block structure.

- [ ] **Step 2: Apply the edit**

Use Edit tool with the following old/new:

**old_string** (the entire step 4 from line 91 through 114 inclusive — the `marked` invocation block):
```
4. Split the rewritten body into richText blocks on H2 boundaries (lines starting with `## `). Each block has the shape:

   ```json
   {
     "blockType": "richText",
     "heading": "<H2 text without the leading '## '>",
     "body": "<HTML of section excluding the H2 line>"
   }
   ```

   The live `RichText.body` field on `siab-payload`'s `pages` collection is a plain `textarea` rendered via `set:html` on the SSR side, so the body must be **HTML, not markdown**. Lexical is configured for the global `lexicalEditor` but is NOT used by the `richText` block — ship plain HTML.

   Convert the per-section markdown to HTML before packing it into the block. The orchestrator standardizes on **`marked`** (resolved on demand via `npx`) — no system install required (covered by the `node`/`pnpm` prereq) and produces the bare HTML fragment Payload needs:

   ```bash
   # After extracting the per-section markdown into $MD_BODY:
   HTML_BODY=$(printf '%s' "$MD_BODY" | npx --yes marked)
   ```

   The `body` value POSTed to Payload must be an HTML string (no `<html>` / `<body>` wrappers — `marked` already produces a fragment by default). If `marked` ever fails (e.g. offline operator without the package cached), the seeder should surface the error and stop — do NOT POST raw markdown.

   Edge cases:
   - **Content before the first H2** (intro paragraphs after the H1): wrap in a leading block with `heading: ""` and the body as the HTML of that pre-H2 section.
   - **No H2s at all** (page is just an H1 + body): produce a single block with `heading: ""` and the entire post-H1 body as HTML.
```

**new_string**:
```
4. Split the rewritten body into richText blocks on H2 boundaries (lines starting with `## `). Each block has the shape:

   ```json
   {
     "blockType": "richText",
     "body": <RtRoot JSON — see below>,
     "anchor": "<slug of the H2 text>"
   }
   ```

   The live `RichText.body` field on `siab-payload`'s `pages` collection is `type: "json"` validated against `rtRootSchema` (block variant) by the `validateRichTextOnSave` collection hook. A POST with a string value hard-fails with `Rich text validation failed: …`. The block has no `heading` field today — the H2 text becomes the in-page anchor instead via the optional `anchor` field.

   Convert the per-section markdown to RtRoot via the orchestrator's `scripts/md-to-rtroot.mjs` helper. Install once per orchestrator clone:

   ```bash
   # Lazy install on first run (idempotent; no-op after first run)
   (cd "${ORCH_ROOT}/scripts" && npm install --silent)
   ```

   Then per section:

   ```bash
   # After extracting the per-section markdown into $MD_BODY:
   BODY_JSON=$(printf '%s' "$MD_BODY" | node "${ORCH_ROOT}/scripts/md-to-rtroot.mjs")
   ```

   `BODY_JSON` is a JSON string ready to use with `--argjson` in the page POST. If the helper fails or emits invalid JSON, surface the error and stop — do NOT POST a fallback shape.

   Compute the anchor from the H2 text:

   ```bash
   ANCHOR=$(printf '%s' "$H2_TEXT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')
   ```

   Pack each section as:

   ```bash
   BLOCK=$(jq -n \
     --argjson body "$BODY_JSON" \
     --arg anchor "$ANCHOR" \
     '{blockType: "richText", body: $body}
      + (if $anchor | length > 0 then {anchor: $anchor} else {} end)')
   ```

   Edge cases:
   - **Content before the first H2** (intro paragraphs after the H1): one block, `anchor` omitted (no H2 text to slugify).
   - **No H2s at all** (page is just an H1 + body): one block with the whole post-H1 body, `anchor` omitted.
```

- [ ] **Step 3: Verify the edit**

```bash
grep -n "md-to-rtroot.mjs" .claude/agents/payload-seeder.md
grep -n "BODY_JSON" .claude/agents/payload-seeder.md
grep -n "blockType: \"richText\"" .claude/agents/payload-seeder.md
grep -c '"heading"' .claude/agents/payload-seeder.md
```

Expected: first three grep hits return line numbers. Fourth grep returns `0` (the `heading` field is fully removed from this section). If `0` then `1`, we forgot to drop the old reference — fix.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/payload-seeder.md
git commit -m "$(cat <<'EOF'
feat(seeder): step 4 emits RtRoot blocks via md-to-rtroot.mjs helper

Replaces the broken markdown→HTML flow (which the current
validateRichTextOnSave hook rejects) with markdown→RtRoot via the
new scripts/md-to-rtroot.mjs helper. Drops the heading field (no
longer in RichText.ts schema) and slugifies the H2 text into the
new optional anchor field instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `payload-seeder.md` step 5 — restructure page POST body

**Files:**
- Modify: `.claude/agents/payload-seeder.md` (step 5 of "What to do", currently lines 116-139)

- [ ] **Step 1: Read current step 5 to confirm context**

```bash
grep -n "POST the page" .claude/agents/payload-seeder.md
# Then read ~25 lines from that line
```

- [ ] **Step 2: Apply the edit**

**old_string** (the entire step 5 from the "POST the page" line through the slug example):
```
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
     -H "Authorization: users API-Key ${PAYLOAD_API_TOKEN}" \
     -H "Content-Type: application/json" \
     -d "${PAGE_BODY}"
   ```

   `<slug>` for `index.md` is `index`; for `about.md` is `about`; etc. (Filename without `.md`.)

   Do NOT send `id` or `updatedAt` — both are server-assigned.
```

**new_string**:
```
5. POST the page using the `jq -n` pattern (NOT a `-d '{ ... }'` literal):

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

   curl -fsS -X POST "${PAYLOAD_API_URL}/api/pages" \
     -H "Authorization: users API-Key ${PAYLOAD_API_TOKEN}" \
     -H "Content-Type: application/json" \
     -d "${PAGE_BODY}"
   ```

   `<slug>` for `index.md` is `index`; for `about.md` is `about`; etc. (Filename without `.md`.)

   Notes on the shape:
   - `description` + `ogImage` are nested under the `seo` group (per current `Pages.ts` schema). Top-level versions are silently dropped by Payload.
   - `status: "published"` is set explicitly — without it, the schema's `defaultValue: "draft"` applies and the SSR site's projection won't include the page until an operator publishes manually in admin.
   - `role`, `order`, and `keywords` from frontmatter are read (for static-site backwards-compat) but NOT sent — the current `Pages.ts` schema has none of these fields.
   - Do NOT send `id` or `updatedAt` — both are server-assigned.
```

- [ ] **Step 3: Verify the edit**

```bash
grep -n "status: \"published\"" .claude/agents/payload-seeder.md
grep -n "seo: (" .claude/agents/payload-seeder.md
grep -c "\"role\"\|--arg role\|\"order\"\|--argjson order\|--argjson keywords" .claude/agents/payload-seeder.md
```

Expected: first two grep hits return line numbers. Third grep should return `0` (no remaining role/order/keywords references in the page-POST body — though they may still appear elsewhere if they describe frontmatter parsing).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/payload-seeder.md
git commit -m "$(cat <<'EOF'
feat(seeder): step 5 page POST body matches current Pages schema

description + ogImage moved under seo group; status explicitly set to
"published" (otherwise schema default "draft" hides the page from the
SSR projection); role/order/keywords dropped (no schema fields). seo.title
defaults to the page title when no separate seoTitle is in frontmatter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `payload-seeder.md` new section — seed `Tenant.siteManifest`

**Files:**
- Modify: `.claude/agents/payload-seeder.md` (insert new section between siteSettings POST and "Body format note")

- [ ] **Step 1: Locate the insertion point**

```bash
grep -n "^## " .claude/agents/payload-seeder.md
```

Find the line where `## Body format note` starts. The new section goes immediately before it.

- [ ] **Step 2: Apply the edit**

**old_string** (the boundary between siteSettings POST block and "Body format note"):
```
Do NOT send `id` or `updatedAt` — both are server-assigned.

## Body format note
```

**new_string**:
```
Do NOT send `id` or `updatedAt` — both are server-assigned.

## Seed Tenant.siteManifest

After siteSettings POST succeeds, seed the tenant's `siteManifest` field. `siab-site-orchestrator` Phase 2 generates `siteManifest.json` at the site repo root by copying `siteManifest.example.json` from the template; this seeder reads it and PATCHes it onto the tenant.

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
  MANIFEST_STATUS="set from $(basename "$MANIFEST_PATH")"
else
  echo "WARN: no siteManifest.json or siteManifest.example.json at site repo root."
  echo "      Tenant will use siab-payload's DEFAULT_MANIFEST."
  echo "      Caveat: DEFAULT_MANIFEST only allows paragraph + h2/h3 + bold/italic;"
  echo "      seeded pages with lists / quotes / dividers will fail validation."
  MANIFEST_STATUS="WARN: not found, using DEFAULT_MANIFEST"
fi
```

This is non-fatal — if both files are missing, surface the warning and continue. The `MANIFEST_STATUS` variable is used in the output contract's `## Site manifest` section.

## Body format note
```

- [ ] **Step 3: Verify the edit**

```bash
grep -n "^## Seed Tenant.siteManifest" .claude/agents/payload-seeder.md
grep -n "MANIFEST_STATUS" .claude/agents/payload-seeder.md
```

Expected: both return line numbers.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/payload-seeder.md
git commit -m "$(cat <<'EOF'
feat(seeder): seed Tenant.siteManifest from site repo's manifest

Closes OBS-49. After siteSettings POST, PATCH Tenant.siteManifest with
the contents of <site>/siteManifest.json (or siteManifest.example.json
fallback). Non-fatal if both missing — operator sees a WARN with the
caveat that DEFAULT_MANIFEST only allows paragraph + h2/h3 + bold/italic
(so seeded markdown with lists/quotes fails validation downstream).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `payload-seeder.md` — rewrite "Body format note"

**Files:**
- Modify: `.claude/agents/payload-seeder.md` ("Body format note" section)

- [ ] **Step 1: Apply the edit**

**old_string** (the entire "Body format note" section as-is):
```
## Body format note

The `siab-payload` `pages` collection's `richText` block has a plain `textarea` for `body` and the SSR site renders it via `set:html`. **Ship plain HTML** (see step 4 above for the markdown->HTML conversion). Lexical is configured for the global `lexicalEditor` but is not used by the `richText` block.

If the live collection schema later changes (e.g., `body` becomes Lexical JSON or a different shape) and a POST 4xx-es with a schema mismatch error, do NOT retry blindly. Stop and report — the orchestrator will escalate the schema contract.
```

**new_string**:
```
## Body format note

The `siab-payload` `pages` collection's `richText.body` field is `type: "json"`, validated against `rtRootSchema` (block variant) by the `validateRichTextOnSave` collection hook. The schema enforces the rt-dom-contract documented at `siab-payload/docs/runbooks/rt-dom-contract.md`. Ship `RtRoot` JSON — never HTML, never markdown text. A POST with a string body hard-fails with `Rich text validation failed: …`.

The seeder produces RtRoot via `node scripts/md-to-rtroot.mjs` (see step 4). The helper walks the markdown AST via `marked.lexer()` and maps tokens to RtNode types per the contract. Unsupported tokens (tables, inline images, embedded HTML) are skipped with stderr warnings.

If the live collection schema later changes (e.g., `body` becomes a different shape) and a POST 4xx-es with a schema mismatch error, do NOT retry blindly. Stop and report — the orchestrator will escalate the schema contract.
```

- [ ] **Step 2: Verify the edit**

```bash
grep -c "ship plain HTML\|Ship plain HTML" .claude/agents/payload-seeder.md
grep -c "Lexical is configured" .claude/agents/payload-seeder.md
grep -n "rtRootSchema" .claude/agents/payload-seeder.md
```

Expected: first two grep hits return `0` (legacy text gone). Third returns a line number (new text present).

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/payload-seeder.md
git commit -m "$(cat <<'EOF'
docs(seeder): rewrite Body format note for RtRoot contract

Replaces the broken "ship plain HTML" instruction with the current
RtRoot contract: rtRootSchema block variant, helper script, hard-fail
behaviour on invalid input. Drops the stale Lexical mention (lexical
is configured for inline rich-text in other blocks but never applied
to richText.body).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `payload-seeder.md` output contract — add Site manifest section

**Files:**
- Modify: `.claude/agents/payload-seeder.md` (output contract report template)

- [ ] **Step 1: Locate the report template**

```bash
grep -n "^## Site settings" .claude/agents/payload-seeder.md
```

The new `## Site manifest` bullet goes immediately after `## Site settings` and before `## Failures`.

- [ ] **Step 2: Apply the edit**

**old_string** (the boundary between Site settings and Failures lines in the report template):
```
## Site settings
- siteSettings created (id <sid>) with brand, language, primaryDomain, NAP, socials.

## Failures
```

**new_string**:
```
## Site settings
- siteSettings created (id <sid>) with brand, language, primaryDomain, NAP, socials.

## Site manifest
- ${MANIFEST_STATUS}    # e.g. "set from siteManifest.json" or "WARN: not found, using DEFAULT_MANIFEST"

## Failures
```

- [ ] **Step 3: Verify the edit**

```bash
grep -n "^## Site manifest" .claude/agents/payload-seeder.md
```

Expected: returns a line number.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/payload-seeder.md
git commit -m "$(cat <<'EOF'
feat(seeder): add Site manifest section to output report

The seed report now includes a Site manifest line showing whether the
tenant's siteManifest got set (from siteManifest.json or its fallback)
or whether it WARN-skipped. Lets the operator see the manifest state
without digging into Payload admin.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification + close-out

**Files:** No code changes; verification only.

- [ ] **Step 1: Re-run the helper test suite**

```bash
cd scripts && node --test
```

Expected: 16/16 pass.

- [ ] **Step 2: Smoke-test the helper end-to-end with a realistic input**

```bash
cat <<'MD' | node scripts/md-to-rtroot.mjs | jq .
# Page Title

Some intro paragraph.

## Werkwijze

We work in three steps.

- Discover
- Design
- Deliver

## Contact

> Reach out anytime.

Email **us** at [hello@example.com](mailto:hello@example.com).
MD
```

Expected: well-formed JSON. Top level: `t: "root"`, `variant: "block"`. Children: paragraph (intro), heading (level 2, "Werkwijze"), paragraph ("We work…"), list (3 items), heading (level 2, "Contact"), blockquote (with paragraph "Reach out anytime."), paragraph (with bold + link).

- [ ] **Step 3: Verify all 5 payload-seeder.md edits landed**

```bash
echo "=== Step 4 (helper) ===" && grep -n "md-to-rtroot.mjs" .claude/agents/payload-seeder.md
echo "=== Step 5 (status published) ===" && grep -n "status: \"published\"" .claude/agents/payload-seeder.md
echo "=== Step 5 (seo group) ===" && grep -n "seo: (" .claude/agents/payload-seeder.md
echo "=== siteManifest section ===" && grep -n "^## Seed Tenant.siteManifest" .claude/agents/payload-seeder.md
echo "=== Body format note (RtRoot) ===" && grep -n "rtRootSchema" .claude/agents/payload-seeder.md
echo "=== Site manifest output ===" && grep -n "^## Site manifest" .claude/agents/payload-seeder.md
```

Expected: all 6 grep hits return line numbers.

- [ ] **Step 4: Confirm no legacy text remains**

```bash
echo "=== old HTML body instruction ===" && grep -c "Ship plain HTML\|ship plain HTML" .claude/agents/payload-seeder.md
echo "=== old heading field ===" && grep -c '"heading": "<H2' .claude/agents/payload-seeder.md
echo "=== old role/order/keywords in POST ===" && grep -c -- "--arg role \|--argjson order \|--argjson keywords " .claude/agents/payload-seeder.md
```

Expected: all three grep counts return `0`.

- [ ] **Step 5: Verify diff scope is clean**

```bash
git diff main --stat
```

Expected: 5 files in the diff:
- `scripts/package.json`
- `scripts/.gitignore`
- `scripts/package-lock.json`
- `scripts/md-to-rtroot.mjs`
- `scripts/md-to-rtroot.test.mjs`
- `.claude/agents/payload-seeder.md`
- `docs/specs/2026-05-18-payload-seeder-rtv2-readiness-design.md` (already committed)
- `docs/plans/2026-05-18-payload-seeder-rtv2-readiness-plan.md` (this file — already committed)

No accidental changes to `prompt.md`, `preflight.md`, `CLAUDE.md`, `.claude/agents/cms-reviewer.md`, `.claude/agents/site-converter.md`, or `README.md`.

- [ ] **Step 6: Verify commit count**

```bash
git log --oneline main..HEAD
```

Expected: 9 commits (spec + plan + 7 implementation commits: 2 for scripts setup + helper, 5 for payload-seeder.md sections).

- [ ] **Step 7: No commit needed if all verifications pass**

If any verification fails, identify which task's edit didn't land cleanly, re-do that task's edit, commit with `fix(obs-49): <what>`, and re-run from Step 1.

---

## Done — what got built

After all 8 tasks:

1. **`scripts/package.json`** + **`scripts/.gitignore`** + **`scripts/package-lock.json`** — isolated workspace with pinned `marked@^14`
2. **`scripts/md-to-rtroot.mjs`** — markdown→RtRoot helper using `marked.lexer()` + AST walker
3. **`scripts/md-to-rtroot.test.mjs`** — 16 `node --test` cases covering all rt-dom-contract node types
4. **`.claude/agents/payload-seeder.md`** — 5 edits:
   - Step 4: MD→RtRoot via helper, new block shape (`{blockType, body, anchor}`)
   - Step 5: Page POST restructure (seo group, drop role/order/keywords, status: published)
   - New "Seed Tenant.siteManifest" section (closes OBS-49)
   - Rewritten "Body format note" for RtRoot contract
   - Output contract gains `## Site manifest` section

**Total estimated effort:** 8 tasks ≈ 30-60 min of focused work + verification (helper is the biggest piece).

**Downstream unlocked:**
1. `site-converter` spec (next, biggest one) — the heavy SSR conversion: 7 conversion groups across Astro config, lib/cms.ts, middleware, BaseLayout tenant-theme injection, Dockerfile, /healthz, delete static content.
2. amblast + siteinabox fresh `/add-cms` runs (after site-converter spec also lands).
