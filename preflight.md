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

Tell the user, in your own words: (a) what the workflow does end-to-end, (b) what subagents are available and when each fires, (c) what the orchestrator never touches (the four sibling repos pre-run; the Payload tenant on failure; GitHub at content-edit time), and (d) where the per-tenant data lands and gets read from. Then ask permission to read `prompt.md` and start Phase 1.
