# Agent notes

Vyom's project context, product rules, and phase-gating rules live in
[CLAUDE.md](CLAUDE.md). Read that first — it is the source of truth for what to
build and, more importantly, what not to build yet.

This file exists to host the managed block below. `next dev` regenerates that
block on every run and writes it here (rather than into CLAUDE.md) as long as
this file keeps the markers intact. Leave them in place.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
