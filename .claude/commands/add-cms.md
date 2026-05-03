---
description: Add Payload CMS to an existing site-<slug> repo (reads preflight.md, awaits confirm, then prompt.md)
---

Add Payload CMS to an existing `optidigi/site-<slug>` repo.

The site slug was passed as: `$ARGUMENTS`

1. Read `preflight.md` in the current working directory.
2. Summarize back to me, in your own words: what the workflow does end-to-end, what subagents are available and when each fires, what the orchestrator never touches, and where per-tenant data lives and gets read from.
3. Wait for me to explicitly confirm your understanding.
4. Once I confirm, read `prompt.md` and begin Phase 1 (Intake) with the slug `$ARGUMENTS` already known.

Do not skip the confirmation gate.

If `$ARGUMENTS` is empty, ask me for the slug before reading preflight.
