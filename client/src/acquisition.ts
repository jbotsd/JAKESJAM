// Acquisition attribution — "where did this visitor come from".
//
// The gap this closes: until now the boot event recorded WHAT device
// arrived (renderer, screen, tier) and nothing about HOW. So a burst of
// six sessions in six minutes was indistinguishable from six strangers,
// six scanner hits, or Jake opening the site on six machines. Grassroots
// posting was unmeasurable by construction, not by accident.
//
// The privacy contract from docs/TELEMETRY.md is preserved, and the two
// deliberate reductions below are the reason it still holds:
//
//   1. HOST ONLY from the referrer, never the path or query. A full
//      referrer URL can carry the visitor's search terms, a private
//      group's URL, or a session token in a query param. The host alone
//      answers "which platform sent them" and can leak none of that.
//   2. UTM values are read from OUR OWN url — parameters we minted and
//      put in our own posts. They describe the campaign, not the person.
//
// Neither is correlatable across sessions, so this changes nothing about
// the "never persisted, never correlated" guarantee.

/**
 * Coarse bucket — the field that actually answers "is the campaign working".
 *
 * `apex` is separate from `self` on purpose. elyad.io is a DIFFERENT page
 * from the game (an Elm landing page carrying no telemetry at all) and it
 * links through to play.elyad.io/?world=1 without forwarding the query. So
 * a visitor who clicks a shared apex link arrives at the game looking like
 * ordinary internal navigation, with their real origin already gone.
 * Folding that into `self` would report the most likely campaign path as
 * "someone moving around inside the site" — the instrument lying quietly,
 * which is the exact failure this file exists to prevent.
 *
 * Reading `apex` correctly: it is an UPPER BOUND on apex-referred arrivals
 * and says nothing about where they were before that hop. Until the apex
 * page forwards utm_* through to the game, that earlier step is
 * unrecoverable — no query here can reconstruct it.
 */
export type RefGroup = "direct" | "social" | "search" | "self" | "apex" | "other";

export type Acquisition = {
  /** Referrer host, e.g. "t.co", "l.facebook.com". "" when there is none. */
  ref: string;
  refGroup: RefGroup;
  /** utm_source if tagged, else the referrer host, else "direct". */
  src: string;
  utmMedium: string;
  utmCampaign: string;
  /** Our own path, no query — which door they came through. */
  landing: string;
};

/**
 * Hosts we consider social. Matched as an exact host OR a dot-suffix, so
 * "l.facebook.com" matches "facebook.com" while "notfacebook.com" does not.
 *
 * Shorteners live here too: t.co and lnkd.in only ever appear as referrers
 * because a link on that platform was clicked, which is the fact we want.
 */
const SOCIAL_HOSTS = [
  "reddit.com",
  "redd.it",
  "t.co",
  "twitter.com",
  "x.com",
  "facebook.com",
  "fb.me",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "discord.com",
  "discordapp.com",
  "bsky.app",
  "mastodon.social",
  "lemmy.world",
  "linkedin.com",
  "lnkd.in",
  "itch.io",
  "news.ycombinator.com",
  "t.me",
  "telegram.org",
  "whatsapp.com",
  "tumblr.com",
  "twitch.tv",
];

const SEARCH_HOSTS = [
  "bing.com",
  "duckduckgo.com",
  "ecosia.org",
  "search.brave.com",
  "yandex.com",
  "startpage.com",
  "qwant.com",
];

/** Google has ~190 ccTLDs; enumerating them would guarantee misses. */
const GOOGLE_HOST = /^google\.(com?|[a-z]{2})(\.[a-z]{2})?$/;

/** The game itself — a referral from here is genuine internal navigation. */
const SELF_HOSTS = ["play.elyad.io", "localhost", "127.0.0.1"];

/** The Elm landing page that funnels into the game. See RefGroup above. */
const APEX_HOSTS = ["elyad.io"];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Bucket a referrer host. An empty host means no referrer was sent. */
export function classifyRef(host: string): RefGroup {
  if (host === "") return "direct";
  // SELF before APEX: play.elyad.io is a dot-suffix of elyad.io, so the
  // narrower match has to win or every in-game navigation reads as apex.
  if (SELF_HOSTS.some((d) => hostMatches(host, d))) return "self";
  if (APEX_HOSTS.some((d) => hostMatches(host, d))) return "apex";
  if (SOCIAL_HOSTS.some((d) => hostMatches(host, d))) return "social";
  if (GOOGLE_HOST.test(host)) return "search";
  if (SEARCH_HOSTS.some((d) => hostMatches(host, d))) return "search";
  return "other";
}

/**
 * Host of a referrer URL, lowercased, "www." stripped so www.reddit.com
 * and reddit.com are one row rather than two.
 *
 * Returns "" for an unparseable or empty referrer rather than throwing —
 * instrumentation must never be the thing that breaks boot.
 */
export function refHost(referrer: string): string {
  if (!referrer) return "";
  try {
    const h = new URL(referrer).hostname.toLowerCase();
    return (h.startsWith("www.") ? h.slice(4) : h).slice(0, 100);
  } catch {
    return "";
  }
}

/**
 * UTM values are ours, but they arrive through a URL a stranger can edit,
 * so they are treated as untrusted input: lowercased, restricted to a
 * slug charset, and truncated. Anything else becomes "" rather than
 * riding into the store as free text.
 */
export function cleanUtm(raw: string | null | undefined): string {
  if (!raw) return "";
  const v = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return v;
}

/**
 * Build the acquisition record from the two things the browser knows.
 * Pure: the caller supplies referrer and url, so this is testable without
 * a DOM and behaves identically under test and in the browser.
 */
export function readAcquisition(referrer: string, url: string): Acquisition {
  const host = refHost(referrer);
  const refGroup = classifyRef(host);

  let utmSource = "";
  let utmMedium = "";
  let utmCampaign = "";
  let landing = "/";
  try {
    const u = new URL(url);
    utmSource = cleanUtm(u.searchParams.get("utm_source"));
    utmMedium = cleanUtm(u.searchParams.get("utm_medium"));
    utmCampaign = cleanUtm(u.searchParams.get("utm_campaign"));
    landing = u.pathname.slice(0, 60) || "/";
  } catch {
    // Malformed location — keep the referrer half rather than losing both.
  }

  // A tagged link is the stronger signal and survives the cases where the
  // referrer does not: in-app browsers (Instagram, TikTok) routinely send
  // no referrer at all, so an untagged post from one of those is
  // indistinguishable from direct traffic. utm_source is how those get
  // attributed, which is why it wins here.
  const src = utmSource || host || "direct";

  return { ref: host, refGroup, src, utmMedium, utmCampaign, landing };
}
