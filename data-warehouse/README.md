# JAKESJAM Data Warehouse

A single SQLite file (`jakesjam.db`, gitignored — rebuild locally, see below) that unifies every internal data source JAKESJAM has collected plus externally-researched market intelligence, so both Jake and any future Claude session can query it directly instead of re-deriving analysis from scratch each time.

## Why this exists

Every prior growth/market analysis this project did (the growth brief, the outreach kit) was a one-off hand-run analysis that lived in prose inside an Artifact — real work, but not reusable or queryable. This warehouse is the same underlying data, normalized into tables, so:
- A new question ("how many candidate-real visitors did we get last Tuesday?") is one SQL query, not a fresh multi-minute investigation.
- External market research (Steam data, demographics, competitor stats) is stored with citations instead of scattered across chat history and one-off artifacts.
- Every future Claude session in this repo can `bun data-warehouse/query.ts "..."` immediately — no rediscovery needed.

## Quick start

```bash
# (Re)build/refresh from all internal sources — idempotent, safe to re-run anytime
bun data-warehouse/ingest.ts

# Refresh the CRM mirror (press/streamer outreach lists)
bun data-warehouse/seed-crm.ts

# Ask it anything
bun data-warehouse/query.ts "SELECT * FROM market_research WHERE domain = 'genre-market-size' ORDER BY confidence DESC"
```

## Schema (see `schema.sql` for the authoritative version)

**Internal / real product data:**
| Table | What |
|---|---|
| `telemetry_events` | Every raw event from `server/.telemetry/events-*.jsonl` (boot/error/net/perf/context-loss) |
| `session_fingerprints` | One row per boot event, pre-computed with `is_jake_rtx4080` / `is_automation_signature` / `is_candidate_real_external` flags — the same device-fingerprint dedup the growth brief did by hand, now a query away |
| `signups` | Email capture funnel (`server/.signups/signups.json`) |
| `entitlements_raw` | Latest snapshot of Stripe cosmetic entitlements |
| `crm_contacts` | Mirror of the Apollo "JAKESJAM Press Outreach" + "JAKESJAM Streamer Outreach" lists (59 contacts: 21 press, 38 tiered streamers) |
| `clips` | Every rendered highlight clip + pin status |

**External market intelligence — always cited, confidence-rated:**
| Table | What |
|---|---|
| `market_research` | Free-form findings: genre market size, retention/acquisition benchmarks, monetization benchmarks, industry trends, streaming analytics — keyed by `domain` |
| `competitor_titles` | Named-competitor stats (Brawlhalla, Rivals of Aether, ROUNDS, etc.) — reviews, CCU, monetization, pricing |
| `portal_analytics` | CrazyGames/Poki/itch.io audience size, RPM, revenue-share terms |
| `audience_demographics` | Age/gender/geography/device breakdowns for relevant player populations |
| `research_log` | Audit trail of every ingest run — when, what, how many rows |

## Adding new research

Every research agent this session was briefed to return pipe-delimited structured lines matching one of the four market-intel table shapes (see `ingest-research.ts`'s header comment for the exact per-table format). To add a new research pass:

1. Run a research agent with the same pipe-delimited output instruction (copy the format spec from `ingest-research.ts`).
2. Save its raw text output to a file.
3. `bun data-warehouse/ingest-research.ts <table> <path-to-file>`

## Honesty rules for this warehouse

- **Internal tables are ground truth** (they're this project's own logs) — trust them.
- **Market-intel tables are third-party, confidence-rated claims** — the `confidence` column and `source_url` exist precisely so nobody (human or AI) treats a `low`-confidence estimate as fact. Always check `source_url` before quoting a market_research number as settled.
- Every ingest is logged in `research_log` — if a number looks stale or wrong, check when it was actually collected before trusting it.

## What this is NOT (yet)

- Not wired to an MCP server — there's no live `sqlite` MCP tool connected in this session, so "AI integration" currently means "any Claude session in this repo can shell out to `bun data-warehouse/query.ts`," not a first-class MCP resource. If you want true MCP-level integration (tool calls instead of shelling out), add an MCP sqlite server pointed at `data-warehouse/jakesjam.db` in Claude Code's settings — the schema is already stable and ready for that.
- Not a real-time pipeline — telemetry/signups/CRM are ingested on-demand via `bun data-warehouse/ingest.ts`, not streamed live. Re-run it before trusting "current" numbers.
