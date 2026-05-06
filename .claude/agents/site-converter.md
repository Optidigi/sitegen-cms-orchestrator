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

### Group 1 — Dependencies + Astro config (single carve-out window)

**Read `astro.config.mjs` first.** The minimum required deltas are:

1. Add `import node from '@astrojs/node';` and `import preact from '@astrojs/preact';` (alongside the existing imports).
2. Set `output: 'server'` (replacing whatever's there, typically `'static'`).
3. Set `adapter: node({ mode: 'standalone' })` (add the property to the `defineConfig` argument).
4. Add `preact({ compat: false, include: ["**/components/cms/**", "**/components/preview/**"] })` to the `integrations` array.

**Use `Edit` for these changes**, preserving every other line of the file. The cloned site may have integrations, vite config, redirects, image config, or other properties beyond what `sitegen-template` ships — none of those should be touched.

Install ALL dependencies in Group 1. Never modify dependencies after Group 1
(carve-out: `@astrojs/preact` and `preact` are sibling installs of
`@astrojs/node`, added for the live-preview block-renderer story; this
is a one-time exception, not a precedent for arbitrary deps).

Run from the cloned site repo root:

```bash
pnpm add @astrojs/node @astrojs/preact preact
```

Then update `astro.config.mjs`:

```js
import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import node from "@astrojs/node"
import preact from "@astrojs/preact"

export default defineConfig({
  site: "https://<primaryDomain>",
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    sitemap(),
    preact({
      compat: false,
      include: ["**/components/cms/**", "**/components/preview/**"],
    }),
  ],
})
```

Only fall back to wholesale `Write` (with the template above) if the existing file has none of the expected `defineConfig` properties (genuinely empty or broken). If the existing file has integrations or vite config beyond what the template above shows, **preserve them** and bail with a diagnostic listing the unfamiliar entries — let the operator confirm they're CMS-safe before proceeding.

Modify `package.json` — verify the new deps landed and a `start` script exists:

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
git commit -m "chore: install @astrojs/node + @astrojs/preact and switch to SSR output"
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
# e.g. /srv/data/saas/siab-payload/tenants/<tenantId>.

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
```

Append to `README.md` (read first; preserve existing content):

```markdown

## CMS-backed mode

This site reads editorial content from a per-tenant Payload CMS data directory mounted into the container at `/data`. Editor changes are visible on the next request — there is no rebuild on content edits.

**Required runtime env:**

- `CMS_DATA_DIR` — defaults to `/data`. Where the per-tenant data is mounted.
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
- <sha> chore: install @astrojs/node + @astrojs/preact and switch to SSR output
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
- **Never modify dependencies after Group 1.** Group 1's only `pnpm add` covers `@astrojs/node @astrojs/preact preact` together (carve-out: `@astrojs/preact` and `preact` are sibling installs of `@astrojs/node`, added for the live-preview block-renderer story; this is a one-time exception, not a precedent for arbitrary deps). If you encounter type errors that seem to need a missing `@types/*` package, bail and report — don't install.
- One logical group = one commit. Do NOT bundle multiple groups into one commit.
- After each commit, do a quick `git status` to confirm the working tree is clean before moving to the next group.
