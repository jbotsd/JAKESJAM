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

const STORAGE_KEY = "jakesjam.signupEmail";
const SESSION_SKIP_KEY = "jakesjam.gateSkip";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Permanent invite to #welcome on the JAKESJAM x INTREPID DEV server.
const DISCORD_INVITE_URL = "https://discord.gg/XrRgTsXWzJ";

function shouldSkip(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kiosk") === "1") return true;
    if (params.get("gate") === "off") return true;
    if (localStorage.getItem(STORAGE_KEY)) return true;
    if (sessionStorage.getItem(SESSION_SKIP_KEY)) return true;
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

export function installEmailGate(): void {
  if (shouldSkip()) return;

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
    } catch {
      /* ignore */
    }
    close();
  });

  document.body.appendChild(gate);
  input.focus();
}
