// Devlog funnel gate — the video CTA made real: "drop your email and
// you're playing the prototype in your browser about eight seconds from
// now." Full-screen overlay above the splash on first visit.
//
// SKIPPED for: the stream kiosk (?kiosk=1), friend/world invite links
// (?world=1 — Fight Night joins must be frictionless), ?gate=off (dev),
// and anyone with an email already on file.
//
// Submit is OPTIMISTIC: we store the email and drop the gate immediately,
// then fire the POST in the background — a slow network must never break
// the eight-second promise. The server dedupes, so retries are free.

const STORAGE_KEY = "jakesjam.signupEmail";
const SESSION_SKIP_KEY = "jakesjam.gateSkip";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function shouldSkip(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kiosk") === "1") return true;
    if (params.get("world") === "1") return true;
    if (params.get("gate") === "off") return true;
    if (localStorage.getItem(STORAGE_KEY)) return true;
    if (sessionStorage.getItem(SESSION_SKIP_KEY)) return true;
  } catch {
    // Storage unavailable (e.g. hardened browser) — never block play.
    return true;
  }
  return false;
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
