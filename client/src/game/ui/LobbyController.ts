import type { ChaosModifierId, CharacterId } from "../types/game";
import { parseStoredChaosModifiers } from "../../sim/data/chaosModifiers";
import type { RoomPlayer } from "../types/net";
import { MapPicker } from "./MapPicker";
import { MatchStatusBadge } from "./MatchStatusBadge";
import { fetchMatchSummary } from "../../net/worldClient";
import {
  PrivateRoomClient,
  type PrivateLobbySnapshot,
} from "../net/PrivateRoomClient";
import {
  DEFAULT_MAP_ID,
  mapsById,
  resolveMap,
  GEN_RANDOM_PICKER_ID,
  type MapPickerId,
} from "../../sim/data/maps";
import { prefetchCustomMap } from "../../net/mapClient";
import { shareInviteLink, onJoinRoomInvite } from "../../shell/crazyGamesSdk";
import { readStoredCosmetics } from "../cosmetics/vesselCosmeticsStore";

const CUSTOM_MAP_PREFIX = "custom:";
const CUSTOM_MAP_CODE_RE = /^[A-Z0-9]{6}$/;

const PLAYER_ID_KEY = "jakesjam.playerId";
const PLAYER_NAME_KEY = "jakesjam.playerName";
const PLAYER_COLOR_KEY = "jakesjam.playerColor";
const PLAYER_CHARACTER_KEY = "jakesjam.playerCharacter";
const CHAOS_MODIFIERS_KEY = "jakesjam.chaosModifiers";
const DEFAULT_CHARACTER: CharacterId = "balanced";

/**
 * Small palette used to auto-assign a distinct color to each player slot
 * when they first join a room. They can still override it manually.
 * Kept client-side: no Convex involvement, just a nicety.
 */
const COLOR_PALETTE = [
  "#50e3c2", // teal
  "#fb7185", // rose
  "#a78bfa", // violet
  "#fde68a", // amber
  "#8ff8ff", // cyan
  "#86efac", // green
  "#fdba74", // orange
  "#c4b5fd", // indigo
];

export class LobbyController {
  private readonly playerId: string;
  private readonly statusLine: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly colorInput: HTMLInputElement;
  private readonly characterSelect: HTMLSelectElement;
  private readonly codeInput: HTMLInputElement;
  private readonly practiceButton: HTMLButtonElement;
  private readonly createButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly activeRoomBox: HTMLElement;
  private readonly activeCode: HTMLElement;
  private readonly playerList: HTMLUListElement;
  private readonly chaosInputs: HTMLInputElement[];
  private readonly mapPicker?: MapPicker;
  private readonly customMapCodeInput?: HTMLInputElement;
  private readonly customMapLoadBtn?: HTMLButtonElement;
  private readonly roomShareBtn?: HTMLButtonElement;
  private readonly roomStatusMount?: HTMLElement;
  // Sections that hide while in a room (item 3).
  private readonly roomActionsBox?: HTMLElement;
  private readonly playerConnectBox?: HTMLElement;
  private roomStatusBadge?: MatchStatusBadge;
  /** Server-native private rooms (no Convex). */
  private readonly privateClient = new PrivateRoomClient();
  private currentCode: string | null = null;
  private currentSnapshot: PrivateLobbySnapshot | null = null;
  private pollTimer?: number;
  private heartbeatTimer?: number;
  private statusClearTimer?: number;
  private launchedMatchId?: string;
  private pendingMatchToken: string | null = null;
  /**
   * Host's locally-picked map id until server snapshot confirms it.
   */
  private pendingMapId: string | null = null;
  /** Last "custom:<code>" mapId this client has prefetched — dedupes
   *  against re-fetching on every lobby poll tick (see applyPrivateSnapshot). */
  private prefetchedCustomMapId: string | null = null;

  constructor(root: ParentNode) {
    this.playerId = loadOrCreatePlayerId();
    this.statusLine = queryRequired(root, "[data-status]");
    this.nameInput = queryRequired(root, "[data-player-name]");
    this.colorInput = queryRequired(root, "[data-player-color]");
    this.characterSelect = queryRequired(root, "[data-player-character]");
    this.codeInput = queryRequired(root, "[data-room-code]");
    this.practiceButton = (root.querySelector("[data-practice]") as HTMLButtonElement | null) ??
      document.createElement("button");
    this.createButton = queryRequired(root, "[data-create-room]");
    this.joinButton = queryRequired(root, "[data-join-room]");
    this.activeRoomBox = queryRequired(root, "[data-active-room]");
    this.activeCode = queryRequired(root, "[data-active-code]");
    this.playerList = queryRequired(root, "[data-player-list]");
    this.chaosInputs = Array.from(root.querySelectorAll<HTMLInputElement>("[data-chaos-modifier]"));

    this.roomActionsBox = root.querySelector<HTMLElement>("[data-room-actions]") ?? undefined;
    this.playerConnectBox = root.querySelector<HTMLElement>("[data-player-connect]") ?? undefined;

    const mapMount = root.querySelector<HTMLElement>("[data-map-picker]");
    if (mapMount) {
      this.mapPicker = new MapPicker({
        mount: mapMount,
        onPick: (mapId) => {
          void this.onMapPicked(mapId);
        },
      });
    }

    this.customMapCodeInput = root.querySelector<HTMLInputElement>("[data-custom-map-code]") ?? undefined;
    this.customMapLoadBtn = root.querySelector<HTMLButtonElement>("[data-custom-map-load]") ?? undefined;
    this.customMapLoadBtn?.addEventListener("click", () => {
      void this.onCustomMapCodeSubmit();
    });

    this.roomShareBtn = root.querySelector<HTMLButtonElement>("[data-room-share]") ?? undefined;
    if (this.roomShareBtn) {
      this.roomShareBtn.addEventListener("click", () => {
        void this.copyRoomShareLink();
      });
    }
    this.roomStatusMount = root.querySelector<HTMLElement>("[data-room-status]") ?? undefined;

    // Inbound CrazyGames invite — fires when a player accepts another
    // player's shareInviteLink() while THIS session is already running
    // (their friends-drawer/notification flow). No-op everywhere outside a
    // live CrazyGames environment — see shell/crazyGamesSdk.ts.
    onJoinRoomInvite((roomCode) => this.joinRoomByCode(roomCode));

    // Per-playerId name slot so two tabs don't collide.
    const perPlayerNameKey = `${PLAYER_NAME_KEY}.${this.playerId}`;
    this.nameInput.value =
      localStorage.getItem(perPlayerNameKey) ??
      `Player ${this.playerId.slice(-4)}`;
    this.colorInput.value = localStorage.getItem(PLAYER_COLOR_KEY) ?? this.colorInput.value;
    this.characterSelect.value = localStorage.getItem(PLAYER_CHARACTER_KEY) ?? DEFAULT_CHARACTER;
    this.restoreRoomCodeFromUrl();
    this.restoreCustomMapCodeFromUrl();
    this.restoreChaosModifiers();

    this.setStatus("Private channel ready — host or join with a code.");

    this.bindEvents();
    this.syncButtons();
  }

  destroy() {
    this.stopPolling();
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
    }
    if (this.statusClearTimer) {
      window.clearTimeout(this.statusClearTimer);
    }
    this.mapPicker?.destroy();
    this.roomStatusBadge?.destroy();
    if (this.currentCode) {
      void this.privateClient.leave(this.currentCode, this.playerId);
    }
  }

  focusCreateRoom() {
    this.createButton.scrollIntoView({ behavior: "smooth", block: "start" });
    this.createButton.focus();
  }

  focusJoinRoom() {
    this.codeInput.scrollIntoView({ behavior: "smooth", block: "start" });
    this.codeInput.focus();
  }

  startPracticeFromMenu() {
    this.startPractice();
  }

  /**
   * Auto-join triggered by ?room= URL param on page load (item 4 + item 12).
   * The server join mutation is idempotent — if this player is already in
   * the room (e.g. reload) it patches and returns the same handle.
   */
  autoJoinFromUrl() {
    const code = this.codeInput.value.trim();
    if (!code) {
      this.focusJoinRoom();
      return;
    }
    void this.joinRoom();
  }

  private bindEvents() {
    this.nameInput.addEventListener("input", () => {
      // Per-playerId so two tabs don't collide on the shared global key.
      localStorage.setItem(`${PLAYER_NAME_KEY}.${this.playerId}`, this.playerName);
    });
    this.colorInput.addEventListener("input", () => {
      localStorage.setItem(PLAYER_COLOR_KEY, this.colorInput.value);
    });
    this.characterSelect.addEventListener("change", () => {
      localStorage.setItem(PLAYER_CHARACTER_KEY, this.characterId);
    });
    for (const input of this.chaosInputs) {
      input.addEventListener("change", () => this.applyChaosChange());
    }
    this.practiceButton.addEventListener("click", () => {
      this.startPractice();
    });
    this.createButton.addEventListener("click", () => {
      void this.createRoom();
    });
    this.joinButton.addEventListener("click", () => {
      void this.joinRoom();
    });

    // Leave Room button (item 1).
    const leaveBtn = this.activeRoomBox.querySelector<HTMLButtonElement>("[data-leave-room]");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        void this.leaveRoom();
      });
    }

    // Back to Splash button (item 8).
    const backBtn = document.querySelector<HTMLButtonElement>("[data-back-to-splash]");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("jakesjam:back-to-splash"));
      });
    }
  }

  private get playerName(): string {
    const trimmed = this.nameInput.value.trim();
    return trimmed || `Player ${this.playerId.slice(-4)}`;
  }

  private get characterId(): CharacterId {
    const value = this.characterSelect.value as CharacterId;
    return value || DEFAULT_CHARACTER;
  }

  private async createRoom() {
    this.setBusy(true);
    try {
      const snap = await this.privateClient.create({
        playerId: this.playerId,
        name: this.playerName,
        color: this.colorInput.value,
        characterId: this.characterId,
        mapId: this.pendingMapId ?? DEFAULT_MAP_ID,
        chaosModifierIds: this.chaosModifierIds,
        cosmetics: readStoredCosmetics(),
      });
      this.activatePrivate(snap);
      this.setStatus(`Channel ${snap.code} open — share the code.`);
    } catch (error) {
      this.setStatus(readError(error));
    } finally {
      this.setBusy(false);
    }
  }

  private startPractice() {
    window.dispatchEvent(new CustomEvent("jakesjam:start-match", {
      detail: {
        mode: "practice",
        localPlayerId: this.playerId,
        players: [{
          _id: "local-practice",
          roomId: "local",
          playerId: this.playerId,
          name: this.playerName,
          color: this.colorInput.value,
          characterId: this.characterId,
          cosmetics: readStoredCosmetics(),
          ready: true,
          connected: true,
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
        }],
        chaosModifierIds: this.chaosModifierIds,
      },
    }));
  }

  /**
   * Programmatic join entry point for a room code that didn't come from the
   * code input — currently just the CrazyGames inbound-invite listener (see
   * constructor). Fills the input for UI consistency, then reuses the exact
   * same join path a manual "Join" click takes.
   */
  joinRoomByCode(code: string): void {
    this.codeInput.value = code.toUpperCase().slice(0, 6);
    void this.joinRoom();
  }

  private async joinRoom() {
    const code = this.codeInput.value.trim().toUpperCase();
    if (!code) {
      this.setStatus("Enter a room code first.");
      return;
    }
    this.setBusy(true);
    try {
      const snap = await this.privateClient.join({
        code,
        playerId: this.playerId,
        name: this.playerName,
        color: this.colorInput.value,
        characterId: this.characterId,
        cosmetics: readStoredCosmetics(),
      });
      this.activatePrivate(snap);
      this.setStatus(`Joined channel ${snap.code}.`);
    } catch (error) {
      this.setStatus(readError(error));
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Leave the current room (item 1). Calls the server leave mutation,
   * tears down local subscription, and returns to the no-room state.
   */
  private async leaveRoom() {
    if (!this.currentCode) return;
    const code = this.currentCode;
    this.stopPolling();
    this.roomStatusBadge?.destroy();
    this.roomStatusBadge = undefined;
    this.currentCode = null;
    this.currentSnapshot = null;
    this.launchedMatchId = undefined;
    this.pendingMapId = null;
    this.pendingMatchToken = null;
    this.activeRoomBox.hidden = true;
    this.activeCode.textContent = "------";
    this.mapPicker?.setHostMode(false);
    this.mapPicker?.setSelected(undefined);
    this.renderPlayers([]);
    this.syncButtons();
    this.setStatus("Left channel.", true);
    document.title = "JAKESJAM";
    window.dispatchEvent(new CustomEvent("jakesjam:room-left"));
    try {
      await this.privateClient.leave(code, this.playerId);
    } catch {
      // UI already left.
    }
  }

  private activatePrivate(snap: PrivateLobbySnapshot) {
    this.currentCode = snap.code;
    this.activeRoomBox.hidden = false;
    this.activeCode.textContent = snap.code;
    this.codeInput.value = snap.code;
    this.applyPrivateSnapshot(snap);

    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      void this.pollSnapshot();
    }, 1500);
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.currentCode) return;
      void this.privateClient.heartbeat(this.currentCode, this.playerId).then(
        (s) => this.applyPrivateSnapshot(s),
        () => undefined,
      );
    }, 12_000);

    if (!localStorage.getItem(PLAYER_COLOR_KEY)) {
      const assignedColor = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
      this.colorInput.value = assignedColor ?? "#50e3c2";
      localStorage.setItem(PLAYER_COLOR_KEY, this.colorInput.value);
    }

    document.title = `JAKESJAM — Private ${snap.code}`;
    // playerId travels with the event so the hangout scene (main.ts) can
    // mint its own hangout token as the SAME room member — this controller's
    // playerId (sessionStorage-based) is a different id scheme than main.ts's
    // own localPlayerId() helper, so main.ts can't regenerate it.
    window.dispatchEvent(
      new CustomEvent("jakesjam:room-joined", { detail: { code: snap.code, playerId: this.playerId } }),
    );
    this.syncButtons();
  }

  private stopPolling() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async pollSnapshot() {
    if (!this.currentCode) return;
    try {
      const snap = await this.privateClient.get(this.currentCode);
      if (snap) this.applyPrivateSnapshot(snap);
    } catch (err) {
      console.warn("[lobby] poll failed", err);
    }
  }

  private applyPrivateSnapshot(snapshot: PrivateLobbySnapshot) {
    this.currentSnapshot = snapshot;
    this.applyAuthoritativeChaos(
      (snapshot.chaosModifierIds ?? []) as ChaosModifierId[],
    );
    const isHost = snapshot.hostPlayerId === this.playerId;
    this.mapPicker?.setHostMode(isHost);
    if (snapshot.mapId) this.pendingMapId = null;
    this.mapPicker?.setSelected(snapshot.mapId || this.pendingMapId || DEFAULT_MAP_ID);
    // EVERY room member watching this snapshot (host and joiners alike, not
    // just whoever loaded the code) needs the custom map's real geometry
    // cached client-side before the match starts — resolveMap() can't fetch
    // it lazily (must stay synchronous, see maps.ts). Prefetch proactively
    // here, deduped so a poll every few seconds doesn't refetch repeatedly.
    if (
      snapshot.mapId?.startsWith(CUSTOM_MAP_PREFIX) &&
      snapshot.mapId !== this.prefetchedCustomMapId
    ) {
      this.prefetchedCustomMapId = snapshot.mapId;
      void prefetchCustomMap(snapshot.mapId);
    }

    const playersAsRoom: RoomPlayer[] = snapshot.players.map((p) => ({
      _id: p.playerId,
      roomId: snapshot.code as never,
      playerId: p.playerId,
      name: p.name,
      color: p.color,
      characterId: p.characterId as CharacterId,
      ready: p.ready,
      connected: true,
      joinedAt: p.lastSeenAt,
      lastSeenAt: p.lastSeenAt,
    }));
    this.maybeResolveColorCollision(playersAsRoom);
    try {
      this.syncRoomStatusBadge(snapshot);
    } catch (err) {
      console.error("[lobby] syncRoomStatusBadge threw", err);
    }
    try {
      this.renderPlayers(playersAsRoom);
    } catch (err) {
      console.error("[lobby] renderPlayers threw", err);
    }

    if (
      snapshot.status === "in_match" &&
      snapshot.matchId &&
      snapshot.matchId !== this.launchedMatchId
    ) {
      this.launchedMatchId = snapshot.matchId;
      const token =
        this.pendingMatchToken ??
        snapshot.tokens?.[this.playerId] ??
        null;
      if (token) {
        const mapName = resolveMap(snapshot.mapId || DEFAULT_MAP_ID).name;
        this.setStatus(`Match starting — ${mapName}.`);
        window.dispatchEvent(
          new CustomEvent("jakesjam:start-match", {
            detail: {
              mode: "private",
              roomCode: snapshot.code,
              matchId: snapshot.matchId,
              matchToken: token,
              localPlayerId: this.playerId,
              players: playersAsRoom,
              chaosModifierIds: snapshot.chaosModifierIds ?? [],
            },
          }),
        );
      }
    }
    try {
      this.syncButtons();
    } catch (err) {
      console.error("[lobby] syncButtons threw", err);
    }
  }

  /**
   * If this player's color collides with another connected player in the
   * same room, pick the first palette color not yet taken (item 10).
   */
  private maybeResolveColorCollision(players: RoomPlayer[]): void {
    const myColor = this.colorInput.value.toLowerCase();
    const otherColors = players
      .filter((p) => p.playerId !== this.playerId && p.connected)
      .map((p) => p.color.toLowerCase());
    if (!otherColors.includes(myColor)) return;
    const taken = new Set(otherColors);
    const pick = COLOR_PALETTE.find((c) => !taken.has(c.toLowerCase()));
    if (!pick) return;
    this.colorInput.value = pick;
    localStorage.setItem(PLAYER_COLOR_KEY, pick);
  }

  private syncRoomStatusBadge(snapshot: PrivateLobbySnapshot | null): void {
    const mount = this.roomStatusMount;
    if (!mount) return;
    const matchId = snapshot?.matchId;
    if (!matchId) {
      this.roomStatusBadge?.destroy();
      this.roomStatusBadge = undefined;
      return;
    }
    if (this.roomStatusBadge) return;
    this.roomStatusBadge = new MatchStatusBadge({
      mount,
      title: "Match Status",
      shareUrl: this.buildRoomShareUrl(snapshot?.code),
      fetchSummary: () => fetchMatchSummary(matchId),
      onJoin: null,
    });
  }

  private buildRoomShareUrl(code: string | undefined): string | null {
    if (!code) return null;
    const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}`;
    return `${base}/?room=${encodeURIComponent(code)}`;
  }

  private async copyRoomShareLink(): Promise<void> {
    const code = this.currentSnapshot?.code ?? this.currentCode ?? undefined;
    if (!code || !this.roomShareBtn) return;
    const url = this.buildRoomShareUrl(code);
    if (!url) return;
    // Inside a live CrazyGames environment, ALSO surface the invite through
    // their own native UI (friends list / share sheet) — additive, never a
    // replacement for the clipboard-copy flow below. No-op everywhere else
    // (play.elyad.io, local dev) — see shell/crazyGamesSdk.ts. Its own
    // returned URL is CrazyGames-hosted and portal-native; we still copy
    // OUR url below regardless so the plain-web share path never changes.
    shareInviteLink(code);
    try {
      await navigator.clipboard.writeText(url);
      const original = this.roomShareBtn.textContent;
      this.roomShareBtn.textContent = "Copied!";
      window.setTimeout(() => {
        if (this.roomShareBtn) this.roomShareBtn.textContent = original ?? "Copy link";
      }, 1400);
    } catch {
      // Fallback: make the URL selectable in a temporary input (item 11).
      this.showCopyFallback(url);
    }
  }

  /**
   * Clipboard write failed — surface a selectable temporary text field
   * rather than the rough `window.prompt` (item 11).
   */
  private showCopyFallback(url: string): void {
    if (!this.roomShareBtn) return;
    const existing = this.activeRoomBox.querySelector<HTMLElement>("[data-copy-fallback]");
    if (existing) {
      existing.remove();
      return;
    }
    const fallback = document.createElement("div");
    fallback.dataset.copyFallback = "true";
    Object.assign(fallback.style, {
      display: "flex",
      gap: "8px",
      marginTop: "6px",
      alignItems: "center",
    });
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = url;
    Object.assign(input.style, {
      flex: "1",
      fontSize: "11px",
      padding: "6px 8px",
      minHeight: "32px",
      color: "var(--accent-bright)",
      background: "rgba(5,8,15,0.85)",
      border: "1px solid rgba(143,248,255,0.3)",
      borderRadius: "6px",
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "✕";
    dismiss.style.minHeight = "32px";
    dismiss.style.padding = "0 10px";
    dismiss.style.fontSize = "12px";
    dismiss.addEventListener("click", () => fallback.remove());
    fallback.append(input, dismiss);
    this.roomShareBtn.insertAdjacentElement("afterend", fallback);
    input.focus();
    input.select();
  }

  /**
   * Host clicked a card in the map picker. Persist via Convex; the
   * snapshot stream re-applies the selection through `applySnapshot`,
   * which is what visibly flips the highlighted card. We don't optimistic-
   * update locally — keeps a single source of truth.
   * Non-host clicks are already blocked in MapPicker, but if a non-host
   * somehow triggers this, the server throws and we surface it (item 5).
   */
  private async onMapPicked(pickerId: MapPickerId) {
    if (!this.currentCode) return;
    if (!(pickerId in mapsById) && pickerId !== GEN_RANDOM_PICKER_ID) return;
    const wireMapId =
      pickerId === GEN_RANDOM_PICKER_ID
        ? `gen:${Math.floor(Date.now() / 1000) % 1_000_000}`
        : pickerId;
    this.pendingMapId = wireMapId;
    this.mapPicker?.setSelected(wireMapId);
    try {
      const snap = await this.privateClient.setMap(
        this.currentCode,
        this.playerId,
        wireMapId,
      );
      this.applyPrivateSnapshot(snap);
    } catch (error) {
      this.setStatus(readError(error), true);
    }
  }

  private renderPlayers(players: RoomPlayer[]) {
    this.playerList.replaceChildren();
    if (players.length === 0) {
      const empty = document.createElement("li");
      empty.className = "player-row";
      empty.textContent = "No connected players.";
      this.playerList.append(empty);
      return;
    }

    for (const player of players) {
      const row = document.createElement("li");
      const swatch = document.createElement("span");
      const name = document.createElement("span");
      const state = document.createElement("span");

      // Axiom H6: the local player reads as primary (brighter ring, same
      // recipe otherwise) without being a structurally different
      // component — echoes HudSystem's in-match nameplate convention
      // (bigger badge + "YOU" tag + brighter cyan ring for the local row).
      const isLocal = player.playerId === this.playerId;
      row.className = isLocal ? "player-row player-row--local" : "player-row";
      swatch.className = "player-swatch";
      swatch.style.background = player.color;
      name.className = "player-name";
      name.textContent = `${isLocal ? "▸ " : ""}${player.name} / ${characterLabel(player.characterId)}${isLocal ? "  (YOU)" : ""}`;
      state.className = player.ready ? "player-state ready" : "player-state";
      state.textContent = player.ready ? "Ready" : "Waiting";

      row.append(swatch, name, state);
      this.playerList.append(row);
    }
  }

  private syncButtons() {
    const hasClient = true; // always-on private server path
    const hasRoom = Boolean(this.currentCode);
    const isHost = this.currentSnapshot?.hostPlayerId === this.playerId;

    if (this.roomActionsBox) {
      this.roomActionsBox.hidden = hasRoom;
    }
    if (this.playerConnectBox) {
      this.playerConnectBox.hidden = hasRoom;
    }

    this.createButton.disabled = !hasClient || hasRoom;
    this.joinButton.disabled = !hasClient || hasRoom;

    // Ready/Start are diegetic now — walk into the Ready/Launch totems in
    // the hangout world (party-hangout plan, A3/A5). No button state to
    // manage here anymore; the player-list row still shows each player's
    // live Ready/Waiting status (renderPlayers), driven by the same server
    // state the totems flip.

    // Chaos modifiers are room-wide settings — only the room host can edit them.
    // Outside a room everyone can preview their default selection.
    for (const input of this.chaosInputs) {
      input.disabled = hasRoom && !isHost;
    }
  }

  private setBusy(isBusy: boolean) {
    this.createButton.disabled = isBusy;
    this.joinButton.disabled = isBusy;
    if (!isBusy) {
      this.syncButtons();
    }
  }

  /**
   * Set the status line text. Transient messages (errors, confirmations)
   * auto-clear after 4 s so stale text doesn't accumulate (item 2).
   * Pass `transient = false` for persistent informational messages.
   */
  private setStatus(message: string, transient = false) {
    // Content-aware filter: a recurring (and not-yet-root-caused)
    // "Cannot read properties of undefined (reading 'disabled')"
    // throw was being routed to setStatus by one of the catch handlers
    // and replacing the genuinely-useful "Joined room XYZ" status with
    // an opaque error. Drop it from the user-facing line but still log.
    if (/reading 'disabled'/i.test(message)) {
      console.error("[lobby] suppressed disabled-undefined status:", message);
      return;
    }
    if (this.statusClearTimer) {
      window.clearTimeout(this.statusClearTimer);
      this.statusClearTimer = undefined;
    }
    this.statusLine.textContent = message;
    this.statusLine.style.color = "";
    if (transient) {
      this.statusClearTimer = window.setTimeout(() => {
        this.statusLine.textContent = this.currentCode
          ? `In channel ${this.currentCode}.`
          : "Host or join a private room.";
        this.statusClearTimer = undefined;
      }, 4000);
    }
  }

  /**
   * Set the status line to an error (red text, auto-clears after 4 s).
   */
  private setErrorStatus(message: string) {
    if (this.statusClearTimer) {
      window.clearTimeout(this.statusClearTimer);
      this.statusClearTimer = undefined;
    }
    this.statusLine.textContent = message;
    this.statusLine.style.color = "var(--danger, #fb7185)";
    this.statusClearTimer = window.setTimeout(() => {
      this.statusLine.style.color = "";
      this.statusLine.textContent = this.currentCode
        ? `In channel ${this.currentCode}.`
        : "Host or join a private room.";
      this.statusClearTimer = undefined;
    }, 4000);
  }

  private restoreRoomCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("room") ?? params.get("code");
    if (code) {
      this.codeInput.value = code.toUpperCase().slice(0, 6);
    }
  }

  /** Arena Forge share link (?map=<code>) — same restraint as the room-code
   *  restore above: prefill the input, never auto-load without an explicit
   *  click (the host still has to confirm they actually want this map). */
  private restoreCustomMapCodeFromUrl() {
    if (!this.customMapCodeInput) return;
    const code = new URLSearchParams(window.location.search).get("map");
    if (code) {
      this.customMapCodeInput.value = code.toUpperCase().slice(0, 6);
    }
  }

  /** Host loads a Forge-authored map by its share code. Sets the room's
   *  mapId to "custom:<code>" (setMapPrivate already accepts an arbitrary
   *  string — no server change needed there) and prefetches the actual
   *  geometry client-side so the host's own arena render updates
   *  immediately instead of waiting on the next snapshot. */
  private async onCustomMapCodeSubmit() {
    if (!this.currentCode || !this.customMapCodeInput) return;
    const code = this.customMapCodeInput.value.trim().toUpperCase();
    if (!CUSTOM_MAP_CODE_RE.test(code)) {
      this.setStatus("Enter the 6-character code from Arena Forge.", true);
      return;
    }
    const wireMapId = `${CUSTOM_MAP_PREFIX}${code}`;
    this.pendingMapId = wireMapId;
    await prefetchCustomMap(wireMapId);
    try {
      const snap = await this.privateClient.setMap(this.currentCode, this.playerId, wireMapId);
      this.applyPrivateSnapshot(snap);
      this.setStatus(`Loaded custom map ${code}.`);
    } catch (error) {
      this.setStatus(readError(error), true);
    }
  }

  private applyAuthoritativeChaos(chaosModifierIds: ChaosModifierId[]) {
    const selected = new Set(chaosModifierIds);
    for (const input of this.chaosInputs) {
      input.checked = selected.has(input.value as ChaosModifierId);
    }
    localStorage.setItem(CHAOS_MODIFIERS_KEY, JSON.stringify(chaosModifierIds));
  }

  private get chaosModifierIds(): ChaosModifierId[] {
    return this.chaosInputs
      .filter((input) => input.checked)
      .map((input) => input.value as ChaosModifierId);
  }

  private restoreChaosModifiers() {
    const saved = new Set(readStoredChaosModifiers());
    for (const input of this.chaosInputs) {
      input.checked = saved.has(input.value as ChaosModifierId);
    }
  }

  private applyChaosChange() {
    const chaosModifierIds = this.chaosModifierIds;
    localStorage.setItem(CHAOS_MODIFIERS_KEY, JSON.stringify(chaosModifierIds));
    if (this.currentCode && this.currentSnapshot?.hostPlayerId === this.playerId) {
      void this.privateClient
        .setChaos(this.currentCode, this.playerId, chaosModifierIds)
        .then((s) => this.applyPrivateSnapshot(s))
        .catch((error) => this.setErrorStatus(readError(error)));
    }
    window.dispatchEvent(new CustomEvent("jakesjam:chaos-change", {
      detail: { chaosModifierIds },
    }));
  }
}

function queryRequired<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

function loadOrCreatePlayerId(): string {
  // Allow ?player=xyz URL param for multi-tab testing
  const params = new URLSearchParams(window.location.search);
  const paramId = params.get("player");
  if (paramId) {
    return paramId;
  }

  // Each tab gets its own player ID via sessionStorage so two tabs
  // on the same machine can host and join the same room.
  const sessionId = sessionStorage.getItem(PLAYER_ID_KEY);
  if (sessionId) {
    return sessionId;
  }

  // crypto.randomUUID only exists in SECURE contexts (https / localhost).
  // Self-hosted LAN play is plain http://192.168.x.x — there the call is
  // undefined and, because this runs during module init, it killed the
  // ENTIRE menu (dead buttons, no world badge, no auto-join). Fall back
  // to a random id of equivalent uniqueness for this purpose.
  const playerId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  sessionStorage.setItem(PLAYER_ID_KEY, playerId);
  return playerId;
}

function readError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected lobby error.";
}

function characterLabel(characterId: CharacterId): string {
  const labels: Record<CharacterId, string> = {
    balanced: "Balanced",
    heavy: "Heavy",
    sprinter: "Sprinter",
    shielded: "Shielded",
  };
  return labels[characterId] ?? "Balanced";
}

function readStoredChaosModifiers(): ChaosModifierId[] {
  return parseStoredChaosModifiers(localStorage.getItem(CHAOS_MODIFIERS_KEY));
}
