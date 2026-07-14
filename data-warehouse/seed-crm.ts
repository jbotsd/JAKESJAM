// Mirrors the JAKESJAM Press Outreach + JAKESJAM Streamer Outreach Apollo
// lists into the warehouse so they're queryable alongside everything else
// without a live Apollo API call. Re-run any time the Apollo lists change —
// idempotent (INSERT OR REPLACE keyed by name+category).
//
// Usage: bun data-warehouse/seed-crm.ts

import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolve(HERE, "jakesjam.db"));
const now = new Date().toISOString();

type Contact = {
  category: "press" | "streamer";
  tier?: string;
  name: string;
  platform?: string;
  organization?: string;
  title?: string;
  url?: string;
  apollo_matched?: boolean;
  linkedin_url?: string;
  notes?: string;
};

const press: Contact[] = [
  { name: "Rich Stanton", organization: "PC Gamer", title: "Senior Editor", apollo_matched: true, linkedin_url: "http://www.linkedin.com/in/richard-stanton-b5a4b0205" },
  { name: "Fraser Brown", organization: "PC Gamer", title: "Online Editor", apollo_matched: false },
  { name: "Lauren Morton", organization: "PC Gamer", title: "Lead SEO Editor (indie/cozy beat)", apollo_matched: true, notes: "best-fit" },
  { name: "Andrea Shearon", organization: "PC Gamer", title: "Evergreen Writer", apollo_matched: true, notes: "best-fit" },
  { name: "Katharine Castle", organization: "Eurogamer", title: "Managing Editor", apollo_matched: false },
  { name: "Dom Peppiatt", organization: "Eurogamer", title: "Deputy Editorial Director", apollo_matched: true },
  { name: "Alice O'Connor", organization: "Rock Paper Shotgun", title: "News Editor", apollo_matched: false },
  { name: "Sin Vega", organization: "Rock Paper Shotgun", title: "Writer, The Rally Point", apollo_matched: false },
  { name: "Edwin Evans-Thirlwell", organization: "Rock Paper Shotgun", title: "News Editor", apollo_matched: false },
  { name: "CJ Andriessen", organization: "Destructoid", title: "Editor-at-Large", apollo_matched: false },
  { name: "Hadley Vincent", organization: "Destructoid", title: "Staff Writer (indie horror beat)", apollo_matched: true, notes: "best-fit" },
  { name: "Chris Kerr", organization: "Game Developer", title: "Senior Editor, News", apollo_matched: false },
  { name: "Bryant Francis", organization: "Game Developer", title: "Senior Editor", apollo_matched: true },
  { name: "Diego Argüello", organization: "Game Developer", title: "Contributing Editor, News (indie beat)", apollo_matched: false, notes: "best-fit" },
  { name: "Danielle Riendeau", organization: "Game Developer", title: "Editor-in-Chief", apollo_matched: true },
  { name: "Lauren Bergin", organization: "PCGamesN", title: "News Editor", apollo_matched: true },
  { name: "Danielle Rose", organization: "PCGamesN", title: "Guides Writer (indie roundups)", apollo_matched: true, notes: "best-fit" },
  { name: "Carlos Zotomayor", organization: "Automaton West", title: "Writer (Japanese indie beat)", apollo_matched: true },
  { name: "Jade King", organization: "TheGamer", title: "Lead Features Editor", apollo_matched: true },
  { name: "Sophie McEvoy", organization: "GamesIndustry.biz", title: "Journalist", apollo_matched: true },
  { name: "Jay Powell", organization: "IndieGameBusiness", title: "Founder/CEO", apollo_matched: false },
].map((c) => ({ ...c, category: "press" as const }));

const streamers: Contact[] = [
  // Tier 1 — micro/small
  { tier: "T1", name: "voidom", platform: "Twitch", url: "https://itch.io/t/5673946/-indie-games-wanted-ill-play-your-game-on-twitch-youtube", notes: "pre-warmed: posted asking for games" },
  { tier: "T1", name: "PatrickR2020", platform: "Twitch", url: "https://itch.io/t/1891849/ill-stream-your-game-updated", notes: "pre-warmed" },
  { tier: "T1", name: "oDB_GAMING", platform: "Twitch", url: "https://itch.io/t/896811/will-play-your-games-and-stream-on-twitch", notes: "pre-warmed" },
  { tier: "T1", name: "MafazGamer", platform: "YouTube", url: "https://itch.io/t/896811/will-play-your-games-and-stream-on-twitch", notes: "pre-warmed" },
  { tier: "T1", name: "rellim", platform: "Twitch", url: "https://sullygnome.com/game/Gang_Beasts", notes: "active Gang Beasts streamer" },
  { tier: "T1", name: "jonwiscas", platform: "Twitch", url: "https://sullygnome.com/game/Gang_Beasts" },
  { tier: "T1", name: "VaaleXC", platform: "Twitch", url: "https://sullygnome.com/game/Gang_Beasts" },
  { tier: "T1", name: "crispeycool", platform: "Twitch", url: "https://sullygnome.com/game/Gang_Beasts" },
  { tier: "T1", name: "brizzy_bee", platform: "Twitch", url: "https://sullygnome.com/game/Gang_Beasts" },
  { tier: "T1", name: "twhopper", platform: "Twitch", url: "https://sullygnome.com/game/Rounds", notes: "active ROUNDS streamer" },
  { tier: "T1", name: "jimzark", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T1", name: "PrejudgedSeeker", platform: "Twitch", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T1", name: "catkostenko", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T1", name: "8-bitgraphix", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T1", name: "handheldgameplayer", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T1", name: "LunaPrincessNinjato", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T1", name: "AnaMoonGameplays", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers", notes: "Spanish-language audience" },
  { tier: "T1", name: "ChillPadGamer", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers", notes: "Russian-language audience" },
  // Tier 2 — mid
  { tier: "T2", name: "Nookrium", platform: "Twitch/YouTube", url: "https://www.twitch.tv/nookrium", notes: "~19K Twitch / 185K YT" },
  { tier: "T2", name: "I Dream of Indie Games", platform: "YouTube", url: "https://www.youtube.com/IDreamofIndie", notes: "~60K subs" },
  { tier: "T2", name: "ClemmyGames", platform: "YouTube", url: "https://www.youtube.com/c/ClemmyGames" },
  { tier: "T2", name: "CABROWN", platform: "YouTube", url: "https://itch.io/t/5481376/an-archived-database-of-mostly-indie-game-youtubersstreamers" },
  { tier: "T2", name: "GetIndieGaming", platform: "YouTube", url: "https://www.youtube.com/channel/UCylVqS5Hk_i175AyCeYKT2w" },
  { tier: "T2", name: "TheViralMelon", platform: "Twitch", url: "https://rivalsofaether.com/introducing-the-rivals-of-aether-streamer-program/", notes: "Rivals of Aether streamer program" },
  { tier: "T2", name: "Kelllyy", platform: "Twitch", url: "https://rivalsofaether.com/introducing-the-rivals-of-aether-streamer-program/" },
  { tier: "T2", name: "Phantom", platform: "Twitch", url: "https://rivalsofaether.com/introducing-the-rivals-of-aether-streamer-program/" },
  { tier: "T2", name: "Mystery Sol", platform: "Twitch", url: "https://rivalsofaether.com/introducing-the-rivals-of-aether-streamer-program/" },
  { tier: "T2", name: "GamerZakh", platform: "Twitch/YouTube", url: "https://www.twitch.tv/gamerzakh", notes: "~212K YT / 15.7K Twitch" },
  { tier: "T2", name: "Angory Tom", platform: "YouTube", url: "https://socialblade.com/youtube/c/angorytom", notes: "~260K subs" },
  { tier: "T2", name: "Phisnom", platform: "YouTube", url: "https://www.youtube.com/@Phisnom", notes: "~230K subs" },
  { tier: "T2", name: "InterndotGif", platform: "YouTube", url: "https://youtube.fandom.com/wiki/InterndotGif", notes: "~420K subs" },
  { tier: "T2", name: "BaerTaffy", platform: "Twitch", url: "https://twitchtracker.com/baertaffy", notes: "~97K followers" },
  { tier: "T2", name: "Alpha Beta Gamer", platform: "Site + YouTube", url: "https://www.alphabetagamer.com/category/browser-game/", notes: "top pick — direct browser-game submission pipeline" },
  // Tier 3 — aspirational
  { tier: "T3", name: "Wanderbots", platform: "YouTube", url: "https://www.youtube.com/Wanderbots", notes: "~517K subs" },
  { tier: "T3", name: "Splattercatgaming", platform: "YouTube", url: "https://www.youtube.com/@Splattercatgaming", notes: "~976K subs" },
  { tier: "T3", name: "Northernlion", platform: "Twitch/YouTube", url: "https://videos.feedspot.com/indie_games_youtube_channels/", notes: "~1.4M subs" },
  { tier: "T3", name: "Jesse Cox", platform: "Twitch/YouTube", url: "https://www.twitch.tv/jessecox", notes: "Convergence Games showcase host, Feb 2026" },
  { tier: "T3", name: "DougDoug", platform: "Twitch/YouTube", url: "https://www.twitch.tv/dougdoug" },
].map((c) => ({ ...c, category: "streamer" as const }));

const insert = db.prepare(
  `INSERT OR REPLACE INTO crm_contacts
   (category, tier, name, platform, organization, title, url, apollo_matched, linkedin_url, notes, added_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

let n = 0;
for (const c of [...press, ...streamers]) {
  insert.run(
    c.category,
    c.tier ?? null,
    c.name,
    c.platform ?? null,
    c.organization ?? null,
    c.title ?? null,
    c.url ?? null,
    c.apollo_matched ? 1 : 0,
    c.linkedin_url ?? null,
    c.notes ?? null,
    now,
  );
  n++;
}

db.prepare(`INSERT INTO research_log (run_at, agent_task, rows_added, summary) VALUES (?, ?, ?, ?)`).run(
  now,
  "seed-crm",
  n,
  "Mirrored JAKESJAM Press Outreach + Streamer Outreach Apollo lists into crm_contacts",
);

console.log(`[seed-crm] ${n} contacts (${press.length} press, ${streamers.length} streamers)`);
db.close();
