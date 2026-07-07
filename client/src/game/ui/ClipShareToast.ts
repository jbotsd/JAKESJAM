// Ephemeral toast surfaced when a highlight clip finishes uploading. Before
// this, ClipRecorder's onUploaded callback only did a console.log — the
// clip's URL was unreachable to a real player, so nothing could ever be
// shared. "Copy link" always works; "Share" uses the native OS share sheet
// (Web Share API — mobile Chrome/Safari) so a player can drop the clip
// straight into TikTok/Instagram/X without any API keys or server-side
// posting integration.

let currentToast: HTMLDivElement | null = null;

const AUTO_DISMISS_MS = 15_000;

export function showClipShareToast(url: string): void {
  currentToast?.remove();

  const root = document.createElement("div");
  Object.assign(root.style, ROOT_STYLE);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Dismiss");
  Object.assign(closeBtn.style, CLOSE_BTN_STYLE);
  closeBtn.addEventListener("click", () => dismiss());

  const heading = document.createElement("div");
  heading.textContent = "\u{1F3AC} Highlight clip ready";
  Object.assign(heading.style, HEADING_STYLE);

  const actions = document.createElement("div");
  Object.assign(actions.style, ACTIONS_STYLE);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy link";
  Object.assign(copyBtn.style, BTN_SECONDARY_STYLE);
  copyBtn.addEventListener("click", () => void copyLink(url, copyBtn));
  actions.appendChild(copyBtn);

  if (canNativeShare()) {
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.textContent = "Share";
    Object.assign(shareBtn.style, BTN_PRIMARY_STYLE);
    shareBtn.addEventListener("click", () => void nativeShare(url));
    actions.appendChild(shareBtn);
  }

  root.append(closeBtn, heading, actions);
  document.body.appendChild(root);
  currentToast = root;

  const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
  function dismiss(): void {
    window.clearTimeout(timer);
    root.remove();
    if (currentToast === root) currentToast = null;
  }
}

function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

async function nativeShare(url: string): Promise<void> {
  try {
    await navigator.share({ title: "JAKESJAM highlight", text: "Check out this play from JAKESJAM!", url });
  } catch {
    // User cancelled the share sheet, or the platform rejected the payload —
    // "Copy link" sits right next to this button as the fallback.
  }
}

async function copyLink(url: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    window.setTimeout(() => {
      btn.textContent = original ?? "Copy link";
    }, 1400);
  } catch {
    window.prompt("Copy this link", url);
  }
}

// ─── Styles (mirrors MatchStatusBadge.ts) ─────────────────────────────────

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  zIndex: "9999",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "12px 14px",
  borderRadius: "12px",
  border: "1px solid rgba(143, 248, 255, 0.18)",
  background: "linear-gradient(160deg, rgba(16, 22, 34, 0.95), rgba(10, 14, 22, 0.98))",
  fontFamily: "Inter, Arial, sans-serif",
  color: "#f7fbff",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
  minWidth: "220px",
  maxWidth: "280px",
};

const CLOSE_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  top: "6px",
  right: "8px",
  background: "transparent",
  border: "none",
  color: "#7a8aa3",
  fontSize: "12px",
  cursor: "pointer",
  padding: "2px",
};

const HEADING_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontWeight: "900",
  letterSpacing: "0.04em",
  color: "#8ff8ff",
  paddingRight: "16px",
};

const ACTIONS_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "8px",
};

const BTN_PRIMARY_STYLE: Partial<CSSStyleDeclaration> = {
  flex: "1",
  padding: "8px 12px",
  border: "1px solid rgba(143, 248, 255, 0.45)",
  borderRadius: "8px",
  background: "linear-gradient(160deg, #1f3a5f, #0f1a2e)",
  color: "#f7fbff",
  fontWeight: "900",
  letterSpacing: "0.08em",
  fontSize: "11px",
  cursor: "pointer",
  textTransform: "uppercase",
};

const BTN_SECONDARY_STYLE: Partial<CSSStyleDeclaration> = {
  flex: "1",
  padding: "8px 10px",
  border: "1px solid rgba(143, 248, 255, 0.18)",
  borderRadius: "8px",
  background: "transparent",
  color: "#8ff8ff",
  fontWeight: "700",
  letterSpacing: "0.06em",
  fontSize: "10px",
  cursor: "pointer",
  textTransform: "uppercase",
};
