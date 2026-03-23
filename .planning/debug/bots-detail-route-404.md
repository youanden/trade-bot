---
status: awaiting_human_verify
trigger: "http://localhost:8787/bots/1 returns 404 — should render a bot details page"
created: 2026-03-21T00:00:00Z
updated: 2026-03-21T00:00:01Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: CONFIRMED — wrangler.toml assets config lacks not_found_handling = "single-page-application", so Wrangler returns 404 for any SPA deep-link path that has no corresponding file in dist/ui/
test: Add not_found_handling to wrangler.toml assets block
expecting: Wrangler will serve index.html for /bots/1 and React Router will handle the route
next_action: Apply fix to wrangler.toml

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Render bot details page showing bot information for bot ID 1
actual: 404 Not Found response
errors: Standard 404 Not Found
reproduction: Navigate to http://localhost:8787/bots/1
started: Never worked — new functionality that hasn't been implemented yet

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: Missing React Router route for /bots/:id
  evidence: App.tsx line 58 shows <Route path="/bots/:id" element={<BotDetail />} /> is already registered; BotDetail.tsx page component exists and is fully implemented
  timestamp: 2026-03-21T00:00:01Z

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-03-21T00:00:01Z
  checked: wrangler.toml assets config
  found: "assets = { directory = \"./dist/ui\" }" — no not_found_handling key
  implication: Wrangler returns 404 for any path that has no file in dist/ui/ (e.g. /bots/1). SPA fallback to index.html is not configured.

- timestamp: 2026-03-21T00:00:01Z
  checked: dist/ui/ contents
  found: Only index.html and assets/ directory — no file at bots/1/index.html
  implication: Confirms Wrangler cannot find a file to serve for /bots/1 and falls through to 404

- timestamp: 2026-03-21T00:00:01Z
  checked: Cloudflare Workers docs + wrangler 4 behavior
  found: not_found_handling = "single-page-application" causes Wrangler to serve index.html with 200 for any unmatched path
  implication: Adding this key is the complete fix

- timestamp: 2026-03-21T00:00:01Z
  checked: src/ui/App.tsx
  found: BrowserRouter wraps all routes including <Route path="/bots/:id" element={<BotDetail />} />
  implication: Once index.html is served, React Router will correctly render BotDetail for /bots/1

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: wrangler.toml assets block lacks not_found_handling = "single-page-application". When a request arrives for /bots/1, Wrangler looks for a file at that path in dist/ui/, finds none, and returns 404 — never serving index.html for the SPA to handle client-side routing.
fix: Add not_found_handling = "single-page-application" to the assets table in wrangler.toml
verification: wrangler.toml updated; awaiting user confirmation that /bots/1 now renders the bot detail page
files_changed: [wrangler.toml]
