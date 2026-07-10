// Public highlight share page — SEO + social unfurl + game advertisement.
// Server-rendered HTML (scrapers never run JS). Raw media stays at /clips/*?raw=1.

import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const CLIPS_DIR = resolve(process.cwd(), ".clips");
const KEPT_DIR = resolve(process.cwd(), ".clips/kept");

export function isClipFilename(filename: string): boolean {
  return /^[a-f0-9-]+\.(webm|mp4)$/i.test(filename);
}

/** UUID only (share routes: /c/<uuid> without extension). */
export function isClipId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}

/** Resolve `uuid` or `uuid.mp4` → on-disk filename, or null. */
export async function resolveClipFilename(idOrFile: string): Promise<string | null> {
  const raw = idOrFile.split("/")[0] ?? "";
  if (isClipFilename(raw)) {
    return (await clipExistsOnDisk(raw)) ? raw : null;
  }
  if (!isClipId(raw)) return null;
  for (const ext of ["mp4", "webm"] as const) {
    const name = `${raw}.${ext}`;
    if (await clipExistsOnDisk(name)) return name;
  }
  return null;
}

/**
 * Serve the marketing share page for a clip URL unless the caller
 * explicitly wants bytes (Range seek, ?raw=1, ?download=1).
 *
 * We intentionally do NOT key on Accept: Cloudflare (and other CDNs)
 * cache one representation per URL and ignore Accept unless the cache
 * key is customized — so a first video/* hit would poison /clips/x.mp4
 * as raw media forever. Default = HTML; raw is an explicit opt-in.
 */
export function requestWantsClipSharePage(req: Request, url: URL): boolean {
  if (url.searchParams.has("raw") || url.searchParams.has("download") || url.searchParams.has("dl")) {
    return false;
  }
  // Byte-range = video player / progressive download — always raw.
  if (req.headers.get("range")) return false;
  return true;
}

export async function clipExistsOnDisk(filename: string): Promise<boolean> {
  if (!isClipFilename(filename)) return false;
  for (const full of [resolve(CLIPS_DIR, filename), resolve(KEPT_DIR, filename)]) {
    if (!full.startsWith(CLIPS_DIR)) continue;
    if (await Bun.file(full).exists()) return true;
  }
  return false;
}

export async function clipByteSize(filename: string): Promise<number | null> {
  for (const full of [resolve(CLIPS_DIR, filename), resolve(KEPT_DIR, filename)]) {
    try {
      const s = await stat(full);
      if (s.isFile()) return s.size;
    } catch {
      /* next */
    }
  }
  return null;
}

export type ClipShareOpts = {
  filename: string;
  origin: string;
  /** Optional pin note for title/description spice. */
  note?: string | null;
  exists: boolean;
  sizeBytes?: number | null;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escJs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/**
 * Full share / marketing / SEO document for one highlight reel.
 * `origin` is brand origin (https://play.elyad.io).
 */
export function renderClipSharePage(opts: ClipShareOpts): string {
  const { filename, origin, note, exists } = opts;
  const idOnly = filename.replace(/\.(webm|mp4)$/i, "");
  const idShort = idOnly.slice(0, 8);
  // Clean /v/ stream URL — no query string (Facebook is picky about og:video).
  // (Avoid /media/ — CF once cached 404s there before the route existed.)
  const mediaUrl = `${origin}/v/${filename}`;
  // Share page WITHOUT .mp4 suffix — if the URL ends in .mp4, FB treats the
  // share as a bare file and often skips the HTML og:video pipeline.
  const pageUrl = `${origin}/c/${idOnly}`;
  const embedUrl = `${origin}/embed/${filename}`;
  const playUrl = `${origin}/?world=1&utm_source=clip&utm_medium=share&utm_campaign=highlight&utm_content=${idShort}`;
  const homeUrl = `${origin}/?utm_source=clip&utm_medium=share&utm_campaign=highlight_home`;
  const ogImage = `${origin}/og-image.png`;
  const favicon = `${origin}/favicon.png`;
  const mime = filename.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/webm";
  // Portrait reel — 9:16. FB/X use these for the player chrome.
  const vidW = 720;
  const vidH = 1280;
  const titleBase = note?.trim()
    ? `${note.trim().slice(0, 80)} · JAKESJAM highlight`
    : "JAKESJAM highlight — crystal arena clip";
  const title = exists ? titleBase : "Clip not found · JAKESJAM";
  const description = exists
    ? "Watch this Hot Lobby highlight from JAKESJAM — free browser arena brawler. Predict, parry, draft roguelite cards. Drop in now — no install."
    : "This highlight is gone or expired. Jump into JAKESJAM Hot Lobby and make your own.";
  const keywords = [
    "JAKESJAM",
    "arena brawler",
    "browser game",
    "multiplayer",
    "roguelite cards",
    "parry",
    "Hot Lobby",
    "free online game",
    "highlight clip",
    "play.elyad.io",
    "elyad",
  ].join(", ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "VideoObject",
        name: title,
        description,
        thumbnailUrl: [ogImage],
        uploadDate: new Date().toISOString(),
        contentUrl: mediaUrl,
        embedUrl: pageUrl,
        url: pageUrl,
        encodingFormat: mime,
        isFamilyFriendly: true,
        inLanguage: "en",
        publisher: {
          "@type": "Organization",
          name: "JAKESJAM",
          url: origin,
          logo: { "@type": "ImageObject", url: ogImage },
        },
        potentialAction: {
          "@type": "WatchAction",
          target: pageUrl,
        },
      },
      {
        "@type": "VideoGame",
        name: "JAKESJAM",
        url: playUrl,
        description:
          "Crystal-arena multiplayer brawler with client-side prediction, parries, and roguelite weapon drafts. Free in the browser.",
        applicationCategory: "Game",
        operatingSystem: "Web browser",
        gamePlatform: "WebBrowser",
        genre: ["Action", "Arena", "Roguelite", "Multiplayer"],
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
        image: ogImage,
        author: { "@type": "Organization", name: "elyad", url: "https://elyad.io/" },
      },
      {
        "@type": "WebPage",
        "@id": pageUrl,
        url: pageUrl,
        name: title,
        description,
        isPartOf: { "@type": "WebSite", name: "JAKESJAM", url: origin },
        primaryImageOfPage: { "@type": "ImageObject", url: ogImage },
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "JAKESJAM", item: origin },
            { "@type": "ListItem", position: 2, name: "Highlights", item: `${origin}/c/` },
            { "@type": "ListItem", position: 3, name: `Clip ${idShort}`, item: pageUrl },
          ],
        },
      },
    ],
  };

  const encPage = encodeURIComponent(pageUrl);
  const encText = encodeURIComponent(
    `Watch this JAKESJAM highlight — free browser arena. Predict · parry · draft.\n${pageUrl}`,
  );
  const encTitle = encodeURIComponent(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="keywords" content="${esc(keywords)}" />
  <meta name="author" content="JAKESJAM / elyad" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1" />
  <meta name="theme-color" content="#06181c" />
  <meta name="color-scheme" content="dark" />
  <link rel="canonical" href="${esc(pageUrl)}" />
  <link rel="icon" type="image/png" href="${esc(favicon)}" />
  <link rel="apple-touch-icon" href="${esc(favicon)}" />
  <link rel="alternate" type="${esc(mime)}" href="${esc(mediaUrl)}" title="Raw highlight media" />
  <link rel="alternate" type="application/json+oembed" href="${esc(origin)}/oembed?url=${encodeURIComponent(pageUrl)}" title="oEmbed" />

  <!-- Open Graph — video first so FB/Discord/iMessage prefer the reel -->
  <meta property="og:type" content="video.other" />
  <meta property="og:site_name" content="JAKESJAM" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(pageUrl)}" />

  <!-- Primary: direct MP4 (Facebook native video preview) -->
  <meta property="og:video" content="${esc(mediaUrl)}" />
  <meta property="og:video:url" content="${esc(mediaUrl)}" />
  <meta property="og:video:secure_url" content="${esc(mediaUrl)}" />
  <meta property="og:video:type" content="${esc(mime)}" />
  <meta property="og:video:width" content="${vidW}" />
  <meta property="og:video:height" content="${vidH}" />

  <!-- Secondary: HTML5 player page (some scrapers want text/html player) -->
  <meta property="og:video" content="${esc(embedUrl)}" />
  <meta property="og:video:secure_url" content="${esc(embedUrl)}" />
  <meta property="og:video:type" content="text/html" />
  <meta property="og:video:width" content="${vidW}" />
  <meta property="og:video:height" content="${vidH}" />

  <!-- Poster / fallback image (after video tags) -->
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:image:secure_url" content="${esc(ogImage)}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="JAKESJAM highlight reel — play free in browser" />

  <!-- Twitter / X player card with direct stream -->
  <meta name="twitter:card" content="player" />
  <meta name="twitter:site" content="@elyad" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
  <meta name="twitter:player" content="${esc(embedUrl)}" />
  <meta name="twitter:player:width" content="360" />
  <meta name="twitter:player:height" content="640" />
  <meta name="twitter:player:stream" content="${esc(mediaUrl)}" />
  <meta name="twitter:player:stream:content_type" content="${esc(mime)}" />

  <!-- App / mobile -->
  <meta name="application-name" content="JAKESJAM" />
  <meta name="apple-mobile-web-app-title" content="JAKESJAM" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta property="al:web:url" content="${esc(playUrl)}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>

  <style>${SHARE_CSS}</style>
</head>
<body>
  <a class="skip" href="#player">Skip to clip</a>

  <header class="top">
    <a class="brand" href="${esc(homeUrl)}" title="JAKESJAM home">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-text">JAKESJAM</span>
      <span class="brand-tag">Hot Lobby</span>
    </a>
    <nav class="top-nav" aria-label="Primary">
      <a href="${esc(playUrl)}" class="btn btn-play">▶ Play free</a>
    </nav>
  </header>

  <main class="wrap">
    <section class="hero">
      <div class="stage-col">
        <div class="phone" id="player">
          <div class="phone-bezel">
            ${
              exists
                ? `<video
              class="reel"
              controls
              playsinline
              autoplay
              muted
              loop
              preload="auto"
              poster="${esc(ogImage)}"
              aria-label="JAKESJAM highlight reel"
            >
              <source src="${esc(mediaUrl)}" type="${esc(mime)}" />
              Your browser cannot play this clip.
              <a href="${esc(mediaUrl)}">Download the file</a>.
            </video>`
                : `<div class="missing">
              <p>Clip not found</p>
              <p class="muted">It may have been rotated off the server. Grab a fresh one in Hot Lobby.</p>
            </div>`
            }
          </div>
          <div class="phone-glow" aria-hidden="true"></div>
        </div>
        ${
          exists
            ? `<p class="vid-meta muted"><span data-live>Live preview</span> · vertical highlight · <a href="${esc(mediaUrl)}" download="${esc(filename)}">download raw</a></p>`
            : ""
        }
      </div>

      <div class="copy-col">
        <p class="eyebrow">Highlight reel · free browser game</p>
        <h1>${esc(exists ? "This is JAKESJAM." : "Jump into JAKESJAM.")}</h1>
        <p class="lede">
          Crystal-arena brawler. <strong>Predict</strong> your opponent,
          <strong>parry</strong> at the last frame, <strong>draft</strong> roguelite weapon cards between rounds.
          Always-on Hot Lobby — no install, no account wall.
        </p>

        <div class="cta-row">
          <a class="btn btn-play btn-lg" href="${esc(playUrl)}">Drop into Hot Lobby</a>
          <a class="btn btn-ghost btn-lg" href="${esc(homeUrl)}">Game home</a>
        </div>

        ${exists ? shareBarHtml(pageUrl, encPage, encText, encTitle, mediaUrl, filename) : ""}

        <ul class="features" aria-label="Why play">
          <li><span class="f-ico">⚔</span><div><strong>Skill-forward combat</strong><br/><span class="muted">Parry windows, movement tech, readable arena geometry</span></div></li>
          <li><span class="f-ico">🃏</span><div><strong>Roguelite drafts</strong><br/><span class="muted">Mutate your weapon every round — unique builds, not static loadouts</span></div></li>
          <li><span class="f-ico">🌐</span><div><strong>Always-on world</strong><br/><span class="muted">Click a link, land in live action. Bots keep the lobby warm</span></div></li>
          <li><span class="f-ico">📱</span><div><strong>Phone + desktop</strong><br/><span class="muted">Touch controls or keyboard — share vertical clips like this one</span></div></li>
        </ul>
      </div>
    </section>

    <section class="promo-band" aria-labelledby="promo-h">
      <div class="promo-art">
        <img src="${esc(ogImage)}" width="1200" height="630" alt="JAKESJAM arena art — crystal duelists mid-parry" loading="lazy" />
      </div>
      <div class="promo-copy">
        <h2 id="promo-h">Made for the clip. Built for the duel.</h2>
        <p>
          Every death can become a shareable highlight. Every match is a card economy.
          Server-authoritative netcode with client prediction — the feel is snappy; the hits are fair.
        </p>
        <ol class="steps">
          <li><strong>Open</strong> play.elyad.io in any browser</li>
          <li><strong>Join</strong> Hot Lobby (or private room code)</li>
          <li><strong>Fight</strong>, draft, and export your best moments</li>
        </ol>
        <a class="btn btn-play" href="${esc(playUrl)}">Play JAKESJAM free →</a>
      </div>
    </section>

    <section class="seo-block" aria-labelledby="about-h">
      <h2 id="about-h">About JAKESJAM</h2>
      <p>
        <strong>JAKESJAM</strong> is a free-to-play multiplayer arena brawler you run in the browser at
        <a href="${esc(homeUrl)}">play.elyad.io</a>.
        It mixes precise platforming combat with roguelite <em>card drafts</em> that reshape your weapon between rounds.
        Matches live in an always-on <em>Hot Lobby</em> world — open a shared link and you are already in the fight.
      </p>
      <p>
        Highlight clips (like this page) are recorded client-side and hosted on the game server so friends,
        Discord, TikTok, and X can unfurl a real preview — then one tap drops them into the same lobby.
      </p>
      <p class="muted small">
        Related: <a href="https://elyad.io/">elyad.io</a> ·
        <a href="${esc(playUrl)}">Hot Lobby</a> ·
        <a href="${esc(origin)}/health">server status</a> ·
        clip id <code>${esc(idShort)}…</code>
        ${opts.sizeBytes != null ? ` · ${esc(fmtBytes(opts.sizeBytes))}` : ""}
      </p>
    </section>
  </main>

  <footer class="foot">
    <div class="foot-inner">
      <div>
        <strong>JAKESJAM</strong>
        <span class="muted"> · crystal-arena brawler · free on the web</span>
      </div>
      <div class="foot-links">
        <a href="${esc(playUrl)}">Play</a>
        <a href="${esc(homeUrl)}">Home</a>
        <a href="https://elyad.io/">elyad.io</a>
        ${exists ? `<a href="${esc(mediaUrl)}" download="${esc(filename)}">Raw video</a>` : ""}
      </div>
    </div>
    <p class="muted tiny">© ${new Date().getFullYear()} JAKESJAM / elyad · Share the fight, not the install.</p>
  </footer>

  <script>
  (function () {
    var PAGE = '${escJs(pageUrl)}';
    var TITLE = '${escJs(title)}';
    var TEXT = 'Watch this JAKESJAM highlight — free browser arena. Predict · parry · draft.';

    function toast(msg) {
      var el = document.getElementById('share-toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(function () { el.classList.remove('show'); }, 2200);
    }

    async function copyLink() {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(PAGE);
        } else {
          var ta = document.createElement('textarea');
          ta.value = PAGE;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        toast('Link copied');
      } catch (e) {
        toast('Copy failed — select the URL bar');
      }
    }

    async function nativeShare() {
      if (!navigator.share) {
        copyLink();
        return;
      }
      try {
        await navigator.share({ title: TITLE, text: TEXT, url: PAGE });
      } catch (e) {
        /* user cancelled */
      }
    }

    document.querySelectorAll('[data-share]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        var kind = btn.getAttribute('data-share');
        if (kind === 'copy') { ev.preventDefault(); copyLink(); }
        if (kind === 'native') { ev.preventDefault(); nativeShare(); }
      });
    });

    // Unmute toggle for autoplay policies
    var v = document.querySelector('video.reel');
    if (v) {
      v.addEventListener('click', function () {
        if (v.muted) { v.muted = false; }
      }, { once: true });
    }
  })();
  </script>
  <div id="share-toast" role="status" aria-live="polite"></div>
</body>
</html>`;
}

function shareBarHtml(
  pageUrl: string,
  encPage: string,
  encText: string,
  encTitle: string,
  mediaUrl: string,
  filename: string,
): string {
  const x = `https://twitter.com/intent/tweet?text=${encText}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encPage}`;
  const reddit = `https://www.reddit.com/submit?url=${encPage}&title=${encTitle}`;
  const wa = `https://wa.me/?text=${encText}`;
  const tg = `https://t.me/share/url?url=${encPage}&text=${encTitle}`;
  const li = `https://www.linkedin.com/sharing/share-offsite/?url=${encPage}`;
  const mail = `mailto:?subject=${encTitle}&body=${encText}`;
  // Discord has no official share URL — copy is the path.
  return `
        <div class="share-block">
          <h2 class="share-h">Share this clip</h2>
          <div class="share-grid" role="group" aria-label="Share destinations">
            <button type="button" class="share-chip primary" data-share="native">↗ Share…</button>
            <button type="button" class="share-chip" data-share="copy">Copy link</button>
            <a class="share-chip" href="${x}" target="_blank" rel="noopener noreferrer">X / Twitter</a>
            <a class="share-chip" href="${fb}" target="_blank" rel="noopener noreferrer">Facebook</a>
            <a class="share-chip" href="${reddit}" target="_blank" rel="noopener noreferrer">Reddit</a>
            <a class="share-chip" href="${wa}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a class="share-chip" href="${tg}" target="_blank" rel="noopener noreferrer">Telegram</a>
            <a class="share-chip" href="${li}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a class="share-chip" href="${mail}">Email</a>
            <button type="button" class="share-chip" data-share="copy" title="Paste into Discord">Discord</button>
            <a class="share-chip" href="${esc(mediaUrl)}" download="${esc(filename)}">Download</a>
          </div>
          <p class="share-url muted"><code id="page-url">${esc(pageUrl)}</code></p>
        </div>`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const SHARE_CSS = `
:root {
  --bg: #040a0e;
  --bg2: #0a141c;
  --panel: #0e1a22;
  --line: #1e3a44;
  --text: #e8f6f4;
  --muted: #7fa3a8;
  --accent: #50e3c2;
  --accent2: #7ad7ff;
  --warn: #ffc857;
  --danger: #ff6b8a;
  --glow: #50e3c255;
  --font: "Space Grotesk", system-ui, sans-serif;
  --mono: "Space Mono", ui-monospace, monospace;
}
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font);
  color: var(--text);
  background:
    radial-gradient(1200px 600px at 10% -10%, #0d3a3a66, transparent 60%),
    radial-gradient(900px 500px at 100% 0%, #12305055, transparent 55%),
    radial-gradient(800px 400px at 50% 100%, #1a104033, transparent 50%),
    var(--bg);
  line-height: 1.5;
}
a { color: var(--accent2); text-decoration-thickness: 1px; text-underline-offset: 3px; }
a:hover { color: var(--accent); }
.skip {
  position: absolute; left: -999px; top: 0; background: var(--accent); color: #04120e;
  padding: 0.5rem 1rem; z-index: 100;
}
.skip:focus { left: 0.5rem; top: 0.5rem; }
.top {
  position: sticky; top: 0; z-index: 40;
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; padding: 0.75rem 1.25rem;
  background: #040a0ecc; backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.brand {
  display: flex; align-items: center; gap: 0.55rem;
  text-decoration: none; color: var(--text); font-weight: 800; letter-spacing: 0.04em;
}
.brand-mark {
  width: 12px; height: 12px; border-radius: 3px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  box-shadow: 0 0 16px var(--glow);
}
.brand-tag {
  font-size: 0.7rem; font-weight: 600; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.5rem;
  letter-spacing: 0.06em; text-transform: uppercase;
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
  font: inherit; font-weight: 700; letter-spacing: 0.03em;
  border-radius: 999px; padding: 0.55rem 1.1rem;
  border: 1px solid transparent; cursor: pointer; text-decoration: none;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s;
}
.btn:active { transform: scale(0.98); }
.btn-play {
  background: linear-gradient(180deg, #3fd6b0, #1f8f78);
  color: #03140f !important;
  box-shadow: 0 0 24px #50e3c244, inset 0 1px 0 #9ff5e0;
  text-decoration: none;
}
.btn-play:hover { box-shadow: 0 0 32px #50e3c266; color: #03140f !important; }
.btn-ghost {
  background: transparent; border-color: var(--line); color: var(--text) !important;
  text-decoration: none;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent) !important; }
.btn-lg { padding: 0.75rem 1.35rem; font-size: 1.05rem; }
.wrap { width: min(1120px, 100%); margin: 0 auto; padding: 1.5rem 1.15rem 3rem; }
.hero {
  display: grid; grid-template-columns: minmax(240px, 360px) 1fr;
  gap: 2rem; align-items: start; margin-bottom: 2.5rem;
}
@media (max-width: 820px) {
  .hero { grid-template-columns: 1fr; justify-items: center; }
  .copy-col { text-align: center; }
  .cta-row, .features { justify-content: center; }
  .features li { text-align: left; }
  .share-grid { justify-content: center; }
}
.phone {
  position: relative; width: min(320px, 86vw); margin: 0 auto;
}
.phone-bezel {
  position: relative; z-index: 1;
  border-radius: 28px; padding: 10px;
  background: linear-gradient(160deg, #1a2e38, #0a1218);
  border: 1px solid #2a4a55;
  box-shadow:
    0 0 0 1px #0008,
    0 30px 60px #000a,
    inset 0 1px 0 #ffffff18;
  aspect-ratio: 9 / 16;
  overflow: hidden;
}
.reel {
  width: 100%; height: 100%; object-fit: cover;
  border-radius: 20px; background: #000; display: block;
}
.phone-glow {
  position: absolute; inset: 10% -20% auto; height: 60%;
  background: radial-gradient(ellipse, var(--glow), transparent 70%);
  filter: blur(20px); z-index: 0; pointer-events: none;
}
.missing {
  height: 100%; display: grid; place-content: center; text-align: center;
  padding: 1.5rem; background: #061018; border-radius: 20px;
}
.vid-meta { text-align: center; font-size: 0.78rem; margin: 0.75rem 0 0; font-family: var(--mono); }
.eyebrow {
  font-family: var(--mono); font-size: 0.75rem; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--accent); margin: 0 0 0.5rem;
}
h1 {
  font-size: clamp(1.85rem, 4vw, 2.6rem); line-height: 1.1;
  margin: 0 0 0.75rem; font-weight: 800; letter-spacing: -0.02em;
}
.lede { font-size: 1.08rem; color: #c5e0dc; margin: 0 0 1.25rem; max-width: 38rem; }
.lede strong { color: var(--accent); font-weight: 700; }
.cta-row { display: flex; flex-wrap: wrap; gap: 0.65rem; margin-bottom: 1.5rem; }
.features {
  list-style: none; padding: 0; margin: 1.5rem 0 0;
  display: grid; gap: 0.85rem;
}
.features li {
  display: grid; grid-template-columns: auto 1fr; gap: 0.75rem;
  padding: 0.85rem 1rem; border-radius: 14px;
  background: var(--panel); border: 1px solid var(--line);
}
.f-ico { font-size: 1.25rem; line-height: 1.4; }
.muted { color: var(--muted); }
.small { font-size: 0.9rem; }
.tiny { font-size: 0.75rem; }
.share-block {
  margin: 1.25rem 0; padding: 1rem 1.1rem;
  border-radius: 16px; border: 1px solid var(--line);
  background: linear-gradient(180deg, #102028, #0b151c);
}
.share-h {
  font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--muted); margin: 0 0 0.75rem; font-weight: 600;
}
.share-grid {
  display: flex; flex-wrap: wrap; gap: 0.45rem;
}
.share-chip {
  appearance: none; font: inherit; font-size: 0.82rem; font-weight: 600;
  padding: 0.45rem 0.75rem; border-radius: 999px;
  border: 1px solid var(--line); background: var(--bg2); color: var(--text);
  text-decoration: none; cursor: pointer;
}
.share-chip:hover { border-color: var(--accent); color: var(--accent); }
.share-chip.primary {
  background: linear-gradient(180deg, #2a6a8a, #1a4058);
  border-color: #3a8ab0; color: #e8f8ff;
}
.share-url {
  margin: 0.85rem 0 0; font-size: 0.72rem; word-break: break-all;
}
.share-url code {
  font-family: var(--mono); color: var(--accent2);
  background: #0006; padding: 0.2rem 0.4rem; border-radius: 6px;
}
.promo-band {
  display: grid; grid-template-columns: 1.2fr 1fr; gap: 1.5rem;
  align-items: center; margin: 2rem 0;
  padding: 1.25rem; border-radius: 20px;
  border: 1px solid var(--line); background: var(--panel);
}
@media (max-width: 820px) { .promo-band { grid-template-columns: 1fr; } }
.promo-art img {
  width: 100%; height: auto; border-radius: 14px; display: block;
  border: 1px solid var(--line);
}
.promo-copy h2 { margin: 0 0 0.65rem; font-size: 1.45rem; }
.steps {
  margin: 1rem 0 1.25rem; padding-left: 1.2rem; color: #c5e0dc;
}
.steps li { margin: 0.35rem 0; }
.seo-block {
  margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
  max-width: 48rem;
}
.seo-block h2 { font-size: 1.15rem; margin: 0 0 0.75rem; }
.seo-block p { color: #b8d0cc; }
.foot {
  border-top: 1px solid var(--line); padding: 1.5rem 1.15rem 2rem;
  background: #020608;
}
.foot-inner {
  width: min(1120px, 100%); margin: 0 auto;
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem;
  align-items: center;
}
.foot-links { display: flex; flex-wrap: wrap; gap: 1rem; }
.foot .tiny { width: min(1120px, 100%); margin: 0.75rem auto 0; }
#share-toast {
  position: fixed; bottom: 1.25rem; left: 50%; transform: translateX(-50%) translateY(120%);
  background: #12352e; color: var(--accent); border: 1px solid #2a8f78;
  padding: 0.55rem 1rem; border-radius: 999px; font-weight: 600; font-size: 0.9rem;
  opacity: 0; transition: transform 0.25s ease, opacity 0.25s ease; z-index: 50;
  pointer-events: none;
}
#share-toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
code { font-family: var(--mono); }
`;

