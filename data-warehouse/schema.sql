-- JAKESJAM Data Warehouse — schema v1
-- SQLite (bun:sqlite, zero extra deps). Single file at data-warehouse/jakesjam.db.
-- Rebuild anytime with: bun data-warehouse/ingest.ts
-- Query anytime with:   bun data-warehouse/query.ts "<sql>"

PRAGMA journal_mode = WAL;

-- ============================================================
-- INTERNAL: real telemetry/product data, ingested from server/.telemetry,
-- server/.signups, server/.entitlements, Apollo CRM exports, clip stores.
-- ============================================================

CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  session TEXT,
  build TEXT,
  seq INTEGER,
  kind TEXT,
  sig TEXT,
  message TEXT,
  data_json TEXT,
  source_file TEXT NOT NULL,
  UNIQUE(session, seq, source_file)
);
CREATE INDEX IF NOT EXISTS idx_telemetry_kind ON telemetry_events(kind);
CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_events(session);
CREATE INDEX IF NOT EXISTS idx_telemetry_at ON telemetry_events(at);

-- One row per session's boot event, with heuristic fingerprint flags —
-- the same dedup logic the growth brief's traffic re-audit used, now
-- materialized as queryable columns instead of one-off prose analysis.
CREATE TABLE IF NOT EXISTS session_fingerprints (
  session TEXT PRIMARY KEY,
  at TEXT,
  build TEXT,
  tier TEXT,
  renderer TEXT,
  touch INTEGER,
  w INTEGER,
  h INTEGER,
  dpr REAL,
  is_jake_rtx4080 INTEGER DEFAULT 0,
  is_automation_signature INTEGER DEFAULT 0,
  is_candidate_real_external INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS signups (
  email TEXT PRIMARY KEY,
  source TEXT,
  at TEXT
);

CREATE TABLE IF NOT EXISTS entitlements_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_json TEXT,
  ingested_at TEXT
);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, -- 'press' | 'streamer'
  tier TEXT,              -- streamer: 'T1'|'T2'|'T3'; press: null
  name TEXT NOT NULL,
  platform TEXT,
  organization TEXT,
  title TEXT,
  url TEXT,
  apollo_matched INTEGER DEFAULT 0,
  linkedin_url TEXT,
  notes TEXT,
  added_at TEXT
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  ext TEXT,
  note TEXT,
  pinned_at TEXT,
  pinned INTEGER DEFAULT 0,
  file_exists INTEGER DEFAULT 0
);

-- ============================================================
-- MARKET INTELLIGENCE: externally-researched, always cited. Never treat
-- a row here as internal ground truth — it's third-party data, confidence
-- varies, always check source_url before quoting a number as fact.
-- ============================================================

CREATE TABLE IF NOT EXISTS market_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,        -- 'genre-market-size' | 'demographics' | 'portal-analytics' |
                                -- 'competitor-monetization' | 'streaming-analytics' |
                                -- 'retention-benchmarks' | 'acquisition-benchmarks' | 'industry-trend'
  topic TEXT NOT NULL,
  finding TEXT NOT NULL,
  metric_name TEXT,
  metric_value TEXT,
  metric_unit TEXT,
  source_name TEXT,
  source_url TEXT,
  collected_at TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium' -- 'high'|'medium'|'low'
);
CREATE INDEX IF NOT EXISTS idx_market_domain ON market_research(domain);

CREATE TABLE IF NOT EXISTS competitor_titles (
  name TEXT PRIMARY KEY,
  genre TEXT,
  platform TEXT,
  steam_reviews_total INTEGER,
  steam_review_pct REAL,
  concurrent_players_peak INTEGER,
  lifetime_players TEXT,
  monetization_model TEXT,
  price_usd REAL,
  release_date TEXT,
  publisher TEXT,
  notes TEXT,
  source_url TEXT,
  collected_at TEXT
);

CREATE TABLE IF NOT EXISTS portal_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal_name TEXT NOT NULL, -- 'CrazyGames' | 'Poki' | 'itch.io' | ...
  metric_name TEXT,
  metric_value TEXT,
  metric_unit TEXT,
  as_of_date TEXT,
  source_url TEXT,
  collected_at TEXT
);

CREATE TABLE IF NOT EXISTS audience_demographics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  population TEXT NOT NULL, -- 'browser-game-players' | 'platform-fighter-players' | 'twitch-viewers' | ...
  dimension TEXT NOT NULL,  -- 'age' | 'gender' | 'geography' | 'device' | 'session-length' | ...
  segment TEXT NOT NULL,    -- e.g. '18-24', 'US', 'mobile'
  value TEXT NOT NULL,      -- e.g. '34%'
  source_name TEXT,
  source_url TEXT,
  collected_at TEXT
);

CREATE TABLE IF NOT EXISTS research_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  agent_task TEXT NOT NULL,
  rows_added INTEGER,
  summary TEXT
);
