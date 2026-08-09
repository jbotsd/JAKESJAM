// Devlog funnel gate — the video CTA made real: "drop your email and
// you're playing the prototype in your browser about eight seconds from
// now." Full-screen overlay above the splash on first visit.
//
// SKIPPED for: the stream kiosk (?kiosk=1), ?gate=off (dev), and anyone
// with an email already on file.
//
// `?world=1` deliberately does NOT skip this (2026-07-20 fix): that param
// is ALSO the game's one public share URL — printed as the literal
// hosting "Share" link (docs/hosting-elyad-io.md), the kiosk launch
// command, and every dev/test instruction in the repo. Letting it skip the
// gate meant the entire email-capture funnel — "the list is the asset"
// (docs/devlog-000-script.md) — was optional for anyone who'd ever seen
// that URL anywhere (stream overlay, doc, chat), forever, with no
// per-recipient scoping or expiry. `docs/venue-goal.md` Pillar 6 already
// planned the real fix (a distinct, signed `?fight` invite token for
// genuine Fight Night repeat traffic) but never shipped it — until that
// lands, `?world=1` gets the same gate as every other first visit.
//
// Submit is OPTIMISTIC: we store the email and drop the gate immediately,
// then fire the POST in the background — a slow network must never break
// the eight-second promise. The server dedupes, so retries are free.

import { ShellEvents } from "./types.js";

const STORAGE_KEY = "jakesjam.signupEmail";
const SESSION_SKIP_KEY = "jakesjam.gateSkip";
/** "maybe later" in post-fight mode — persistent and timestamped, so a
 *  refresh or a second tab does not re-ask someone who already declined. */
const SKIP_UNTIL_KEY = "jakesjam.gateSkipUntil";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Permanent invite to #welcome on the JAKESJAM x INTREPID DEV server.
const DISCORD_INVITE_URL = "https://discord.gg/XrRgTsXWzJ";

// ── Doors 1.2 · DECISION 1 (Jake's) ──────────────────────────────────────
//
// Where does the email ask belong? Today it is the FIRST thing a visitor
// meets — and since Doors 1.1 made the venue the landing, it is now the
// ONLY thing between a stranger and the game. The end-of-demo-screen
// pattern says ask at peak intent instead: after a full cycle, when they
// know whether they care.
//
// Built per L4: the recommended change is implemented and DARK. While
// this reads "boot", behaviour is preserved bit-for-bit, so ratifying is
// exactly one line. Nothing auto-flips on silence — L4 names the live
// gate position as consent-class.
export type GatePosition = "boot" | "post-fight";

/** ← THE ONE LINE. "boot" = today. "post-fight" = Decision 1 ratified. */
const DEFAULT_GATE_POSITION: GatePosition = "boot";

/** How long "maybe later" is honoured in post-fight mode. Long enough
 *  that declining means something; short enough that a returning regular
 *  is eventually asked again. */
const SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Resolve the position. The override exists so the flip can be TESTED
 *  and demoed without editing source: `?gate-position=post-fight`, or
 *  localStorage `jakesjam.gatePosition`. */
export function gatePosition(): GatePosition {
  try {
    const q = new URLSearchParams(window.location.search).get("gate-position");
    if (q === "post-fight" || q === "boot") return q;
    const stored = localStorage.getItem("jakesjam.gatePosition");
    if (stored === "post-fight" || stored === "boot") return stored;
  } catch {
    /* storage/URL unavailable — fall through to the default */
  }
  return DEFAULT_GATE_POSITION;
}

/** True while a post-fight "maybe later" is still in its cooldown. */
function skipCooldownActive(now: number): boolean {
  try {
    const until = Number(localStorage.getItem(SKIP_UNTIL_KEY) ?? "0");
    // A clock that moved backwards must not extend a decline forever.
    return Number.isFinite(until) && until > now && until - now <= SKIP_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function shouldSkip(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kiosk") === "1") return true;
    if (params.get("gate") === "off") return true;
    if (localStorage.getItem(STORAGE_KEY)) return true;
    if (sessionStorage.getItem(SESSION_SKIP_KEY)) return true;
    // Post-fight mode only: a persistent decline. Deliberately NOT
    // consulted in "boot" mode so the dark default is byte-identical to
    // the behaviour that shipped.
    if (gatePosition() === "post-fight" && skipCooldownActive(Date.now())) return true;
  } catch {
    // Storage unavailable (e.g. hardened browser) — never block play.
    return true;
  }
  return false;
}

// Post-submit Discord CTA. Deliberately a TOAST, not an interstitial: the
// gate's whole contract is "you're playing in about eight seconds", so the
// ask comes AFTER the conversion, on a non-blocking strip that dismisses
// itself. Shown only to submitters — skippers haven't committed to Fight
// Night yet and get the splash's own Discord button instead.
function showDiscordToast(): void {
  const toast = document.createElement("div");
  toast.className = "discord-toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = `
    <span class="discord-toast-copy">✓ You're on the list — Fight Night lands Friday.</span>
    <a class="discord-toast-link" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener">Join the Discord</a>
    <button type="button" class="discord-toast-close" aria-label="Dismiss">×</button>
  `;
  const remove = () => toast.remove();
  toast.querySelector(".discord-toast-close")?.addEventListener("click", remove);
  window.setTimeout(remove, 14_000);
  document.body.appendChild(toast);
}

function submitSignup(email: string): void {
  void fetch("/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, source: "splash" }),
  }).catch(() => {
    // Lost signup beats blocked player; the stored email lets a future
    // session retry if we ever want to.
  });
}

/**
 * Install the gate according to the resolved position (Doors 1.2).
 *
 * "boot"       — today: the overlay goes up immediately.
 * "post-fight" — nothing at boot; the overlay waits for the player to
 *                finish a cycle (ShellEvents.CYCLE_COMPLETED) and then
 *                asks once, at peak intent.
 */
export function installEmailGate(): void {
  if (gatePosition() === "post-fight") {
    // Re-check shouldSkip at fire time, not now: over the course of a
    // whole cycle the player may have signed up by another route, and a
    // gate that ignores that would ask a subscriber for their email
    // moments after they gave it.
    const onCycle = () => {
      window.removeEventListener(ShellEvents.CYCLE_COMPLETED, onCycle);
      if (shouldSkip()) return;
      showEmailGate();
    };
    window.addEventListener(ShellEvents.CYCLE_COMPLETED, onCycle);
    return;
  }
  if (shouldSkip()) return;
  showEmailGate();
}

function showEmailGate(): void {
  const gate = document.createElement("div");
  gate.className = "email-gate";
  gate.innerHTML = `
    <div class="email-gate-frame">
      <p class="splash-kicker">JAKESJAM</p>
      <h2>Enter the arena</h2>
      <p class="email-gate-copy">
        Drop your email and you're playing in about eight seconds.
        Fight Night invite every Friday — that's it, no other mail.
      </p>
      <form class="email-gate-form" novalidate>
        <input
          class="email-gate-input"
          type="email"
          name="email"
          placeholder="you@wherever.com"
          autocomplete="email"
          spellcheck="false"
          required
        />
        <button type="submit" class="primary shell-cta-primary">Play now</button>
      </form>
      <p class="email-gate-error" hidden>That email doesn't look right.</p>
      <button type="button" class="email-gate-skip">maybe later</button>
    </div>
  `;

  const form = gate.querySelector<HTMLFormElement>(".email-gate-form");
  const input = gate.querySelector<HTMLInputElement>(".email-gate-input");
  const error = gate.querySelector<HTMLElement>(".email-gate-error");
  const skip = gate.querySelector<HTMLButtonElement>(".email-gate-skip");
  if (!form || !input || !error || !skip) return;

  const close = () => {
    gate.remove();
  };

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      error.hidden = false;
      input.focus();
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, email);
    } catch {
      /* storage full/blocked — still let them in */
    }
    submitSignup(email);
    close();
    showDiscordToast();
  });

  skip.addEventListener("click", () => {
    try {
      sessionStorage.setItem(SESSION_SKIP_KEY, "1");
      // Post-fight mode also remembers the decline across tabs and
      // reloads (Doors 1.2). The old per-tab skip meant "maybe later"
      // lasted until the next refresh, so a declining player got asked
      // again and again — nagging the exact person who already said no.
      if (gatePosition() === "post-fight") {
        localStorage.setItem(SKIP_UNTIL_KEY, String(Date.now() + SKIP_COOLDOWN_MS));
      }
    } catch {
      /* ignore */
    }
    close();
  });

  document.body.appendChild(gate);
  input.focus();
}
