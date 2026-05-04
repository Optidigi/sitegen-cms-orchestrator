# Sitegen CMS runbook

You have read `preflight.md` and the user has confirmed your understanding. Follow this runbook phase-by-phase. Each **GATE** marker is a hard stop — do not proceed past it without the action specified.

The slash command was invoked as `/add-cms <slug>`. The slug is your primary identifier throughout.

---

## Phase 1 — Intake

(Note: `gh` auth was verified in `preflight.md`'s "Environment readiness" check before you got here.)

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

1. **VPS host path for this tenant's Payload data directory.** Convention: `/srv/data/saas/siab-payload/tenants/<tenantId>` (tenant ID is filled in after Phase 3, so accept either a complete path or a path with a `<tenantId>` placeholder).
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
  -H "Authorization: users API-Key ${PAYLOAD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" > /tmp/tenant-create.json

TENANT_ID=$(jq -r '.doc.id // .id' /tmp/tenant-create.json)
echo "Tenant created: ${TENANT_ID}"
```

`TENANT_ID` is now the canonical reference for the rest of the run. Substitute it for every `<tenantId>` placeholder in Phases 4, 8, 9 (compose snippet), and 10. The full create response also persists in `/tmp/tenant-create.json` for re-reads.

If the response indicates "tenant already exists" (4xx with that hint), bail per idempotency rules.

If the operator's intake had a `<tenantId>` placeholder in the VPS data path, replace it now and confirm the resolved path back:

```
Resolved VPS data path: /srv/data/saas/siab-payload/tenants/<tenantId>
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
  -H "Authorization: users API-Key ${PAYLOAD_API_TOKEN}" \
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
