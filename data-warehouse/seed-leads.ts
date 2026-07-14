// Partnership/BD/showcase/community leads (2026-07-14 research pass).
// Extends crm_contacts with new category values (partnership, showcase,
// community) rather than a new table — category is a plain string, so
// this fits without a schema migration. Idempotent-ish: re-running
// creates duplicate rows (no natural unique key across name+category was
// enforced), so only re-run after clearing or when adding a genuinely
// new batch, not as a routine resync like ingest.ts/seed-crm.ts.
//
// Usage: bun data-warehouse/seed-leads.ts

import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolve(HERE, "jakesjam.db"));
const now = new Date().toISOString();

const rows: Array<{
  category: string; name: string; organization?: string; title?: string;
  url?: string; notes?: string; platform?: string;
}> = [
  { category: "partnership", name: "Evil Landfall (publishing arm)", organization: "Landfall Games", title: "Indie publisher/funder", url: "https://evillandfall.com", notes: "Real, documented pattern of funding physics-driven chaotic-multiplayer indies (co-developed PEAK w/ Aggro Crab). Near-exact genre match. Site is landing-page-only as of research date, email signup only." },
  { category: "partnership", name: "Nick Kaman (via press contact)", organization: "Aggro Crab", title: "Co-founder", url: "mailto:contact@aggrocrab.com", notes: "Physics-comedy/co-op genre neighbor, actively cross-promotes (Landfall on PEAK, charity bundle w/ Digiphile). Discord: discord.gg/aggrocrab" },
  { category: "partnership", name: "Boneloaf press contact", organization: "Boneloaf (Gang Beasts)", title: "press@boneloaf.co — explicitly scoped for streaming/marketing outreach", url: "mailto:press@boneloaf.co", notes: "Direct physics-comedy-brawler genre match. Community Discord ~11k members." },
  { category: "partnership", name: "Recreate Games (thin lead)", organization: "Party Animals", url: "https://forum.partyanimals.com/d/9545-contact-the-developers", notes: "No named contact found despite searching — only a player forum thread + parent (Source Technology) LinkedIn. Flagged thin." },
  { category: "partnership", name: "Nahee Lee", organization: "CrazyGames", title: "Partnerships / \"Alliance architect\"", notes: "Named partnerships contact distinct from generic dev submission form. LinkedIn only, no direct email found." },
  { category: "partnership", name: "Rafael Morgan", organization: "CrazyGames", title: "VP Marketing & Partnerships", notes: "Most senior named partnerships contact at CrazyGames found. LinkedIn only." },
  { category: "partnership", name: "Everton", organization: "CrazyGames", title: "Developer Relations captain", notes: "Closest match to dev-facing (not ad-sales) partnerships at CrazyGames." },
  { category: "partnership", name: "Romy Halfweeg", organization: "Poki", title: "Business Development Manager", url: "https://nl.linkedin.com/in/romyhalfweeg", notes: "Confirmed current title. Self-described former indie dev — 'We sign a developer more so than a game.' Best single BD contact found in this whole pass." },
  { category: "partnership", name: "Michiel van Amerongen", organization: "Poki", title: "Co-Founder (ex-Business Development)", url: "https://nl.linkedin.com/in/michiel-van-amerongen-1a1b739", notes: "Fallback/escalation contact above Romy Halfweeg." },
  { category: "showcase", name: "Evo Indie Dev Gallery", organization: "Evo (fighting-game tournament)", url: "https://evo.gg/indiedevs/", notes: "BEST genre fit found — dedicated indie fighting-game showcase at the FGC's flagship event. No public submission form/deadline found; likely curated, watch @Evo on X." },
  { category: "showcase", name: "Day of the Devs", organization: "Double Fine / iam8bit, part of Summer Game Fest", url: "https://www.dayofthedevs.org/submit", notes: "Real open submission, no fee, favors 'unique unpolished' over polished-generic. 2026 Summer window closed; Winter Showcase submissions open ~Aug 2026, close ~Oct 2026." },
  { category: "showcase", name: "The MIX (Media Indie Exchange)", organization: "Summer Game Fest", url: "https://mediaindieexchange.com/", notes: "Real, active, indie-focused, no paid booth. Submission windows announced per-cycle on @indieexchange X account, not a standing form — watch for the next call." },
  { category: "showcase", name: "Gamedev.js Jam", organization: "gamedevjs.com (Andrzej Mazur)", url: "https://gamedevjs.com/jam/2026/", notes: "Direct technical fit — explicitly an HTML5/browser-game jam, Phaser's own team co-promotes it. 2026 edition ran Apr 13-26; next ~April 2027." },
  { category: "showcase", name: "Tiny Teams (conditional — needs a Steam page)", organization: "Yogscast Games", url: "https://www.yogscast.games/news/tiny-teams-2025-submissions-open", notes: "Real, selective (~250 of 2200+ accepted 2025), team-size cap fits solo dev. BUT it's a Steam festival — JAKESJAM has no Steam page, so likely unusable without standing one up." },
  { category: "showcase", name: "Wholesome Direct (poor tonal fit)", organization: "Wholesome Games", url: "https://wholesomegames.com/", notes: "Open submission but curatorially cozy/wholesome — a PvP fighter is a tonal mismatch. Included for completeness, not recommended." },
  { category: "community", name: "McLeodGaming / Fraymakers Discord", organization: "McLeodGaming", url: "https://discord.com/invite/mcleodgaming", notes: "~46,600+ members — by far the largest genuine platform-fighter-genre Discord found. Direct genre-overlap audience." },
  { category: "community", name: "Gang Beasts Community Discord", organization: "Boneloaf-linked, dev-endorsed", url: "https://discord.com/invite/gang-beasts-discord-209851842757263360", notes: "~10,900 members, community-run but Boneloaf has publicly pointed people to it." },
  { category: "community", name: "Rushdown Revolt Discord", organization: "Vortex Games / Combat Lab, Inc.", url: "https://discord.com/invite/rushdownrevolt", notes: "~5,350 members, active platform-fighter community." },
  { category: "community", name: "Aggro Crab Discord", organization: "Aggro Crab", url: "https://aggrocrab.com/Going-Under-PressKit", notes: "Direct line into the PEAK/Content Warning fanbase — physics-chaos-multiplayer audience adjacent to JAKESJAM." },
];

const insert = db.prepare(
  `INSERT INTO crm_contacts (category, tier, name, platform, organization, title, url, apollo_matched, linkedin_url, notes, added_at)
   VALUES (?, NULL, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
);
for (const r of rows) {
  insert.run(r.category, r.name, r.platform ?? null, r.organization ?? null, r.title ?? null, r.url ?? null, r.notes ?? null, now);
}
console.log(`Inserted ${rows.length} partnership/showcase/community leads`);
db.close();
