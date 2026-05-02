import { RoomClient, createRoomArgs } from "../net/RoomClient";
import type { ChaosModifierId, CharacterId } from "../types/game";
import { parseStoredChaosModifiers } from "../../sim/data/chaosModifiers";
import type { RoomHandle, RoomPlayer, RoomSnapshot } from "../types/net";
import { MapPicker } from "./MapPicker";
import { MatchStatusBadge } from "./MatchStatusBadge";
import { fetchMatchSummary } from "../../net/worldClient";
import { DEFAULT_MAP_ID, mapsById, type MapId } from "../../sim/data/maps";

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
  private readonly readyButton: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly activeRoomBox: HTMLElement;
  private readonly activeCode: HTMLElement;
  private readonly playerList: HTMLUListElement;
  private readonly chaosInputs: HTMLInputElement[];
  private readonly mapPicker?: MapPicker;
  private readonly roomShareBtn?: HTMLButtonElement;
  private readonly roomStatusMount?: HTMLElement;
  // Sections that hide while in a room (item 3).
  private readonly roomActionsBox?: HTMLElement;
  private readonly playerConnectBox?: HTMLElement;
  private roomStatusBadge?: MatchStatusBadge;
  private readonly roomClient?: RoomClient;
  private currentRoom?: RoomHandle;
  private currentSnapshot: RoomSnapshot | null = null;
  private unsubscribeRoom?: () => void;
  private heartbeatTimer?: number;
  private statusClearTimer?: number;
  private launchedMatchId?: string;
  /**
   * Host's locally-picked map id, set the moment they click a card in
   * the picker. Persists across snapshot rounds so a degraded sync
   * (Convex codegen lag, server down) doesn't lose the choice.
   * Cleared on leaveRoom + on snapshot.room.selectedMapId arriving
   * back from the server (which means sync caught up).
   */
  private pendingMapId: MapId | null = null;

  constructor(root: ParentNode) {
    this.playerId = loadOrCreatePlayerId();
    this.statusLine = queryRequired(root, "[data-status]");
    this.nameInput = queryRequired(root, "[data-player-name]");
    this.colorInput = queryRequired(root, "[data-player-color]");
    this.characterSelect = queryRequired(root, "[data-player-character]");
    this.codeInput = queryRequired(root, "[data-room-code]");
    this.practiceButton = queryRequired(root, "[data-practice]");
    this.createButton = queryRequired(root, "[data-create-room]");
    this.joinButton = queryRequired(root, "[data-join-room]");
    this.readyButton = queryRequired(root, "[data-ready-toggle]");
    this.startButton = queryRequired(root, "[data-start-match]");
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

    this.roomShareBtn = root.querySelector<HTMLButtonElement>("[data-room-share]") ?? undefined;
    if (this.roomShareBtn) {
      this.roomShareBtn.addEventListener("click", () => {
        void this.copyRoomShareLink();
      });
    }
    this.roomStatusMount = root.querySelector<HTMLElement>("[data-room-status]") ?? undefined;

    // Per-playerId name slot so two tabs on one PC (each with its own
    // sessionStorage playerId) don't collide on the shared global name —
    // otherwise you get "Waiting on: zZDas, zZDas" in any 1v1 dev test.
    // Default for a brand-new playerId is "Player <last4>" — already unique
    // because the playerId itself is unique per tab.
    const perPlayerNameKey = `${PLAYER_NAME_KEY}.${this.playerId}`;
    this.nameInput.value =
      localStorage.getItem(perPlayerNameKey) ??
      `Player ${this.playerId.slice(-4)}`;
    this.colorInput.value = localStorage.getItem(PLAYER_COLOR_KEY) ?? this.colorInput.value;
    this.characterSelect.value = localStorage.getItem(PLAYER_CHARACTER_KEY) ?? DEFAULT_CHARACTER;
    this.restoreRoomCodeFromUrl();
    this.restoreChaosModifiers();

    const convexUrl = readConvexUrl();
    if (convexUrl) {
      this.roomClient = new RoomClient(convexUrl);
      this.setStatus("Connected. Create or join a room.");
    } else {
      this.setStatus("Set VITE_CONVEX_URL to enable rooms.");
    }

    this.bindEvents();
    this.syncButtons();
  }

  destroy() {
    this.unsubscribeRoom?.();
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
    }
    if (this.statusClearTimer) {
      window.clearTimeout(this.statusClearTimer);
    }
    this.mapPicker?.destroy();
    this.roomStatusBadge?.destroy();
    if (this.roomClient && this.currentRoom) {
      void this.roomClient.leave(this.currentRoom.roomId, this.playerId);
    }
    void this.roomClient?.close();
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
    if (!code || !this.roomClient) {
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
    this.readyButton.addEventListener("click", () => {
      void this.toggleReady();
    });
    this.startButton.addEventListener("click", () => {
      void this.startMatch();
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
    if (!this.roomClient) {
      return;
    }
    this.setBusy(true);
    try {
      const handle = await this.roomClient.createRoom(
        createRoomArgs(
          this.playerId,
          this.playerName,
          this.colorInput.value,
          this.characterId,
          this.chaosModifierIds,
        ),
      );
      this.activateRoom(handle);
      this.setStatus(`Room ${handle.code} created. Share the code.`);
    } catch (error) {
      this.setStatus(readError(error));
    } finally {
      this.setBusy(false);
    }
  }

  private startPractice() {
    window.dispatchEvent(new CustomEvent("jakesjam:start-match", {
      detail: {
        localPlayerId: this.playerId,
        players: [{
          _id: "local-practice",
          roomId: "local",
          playerId: this.playerId,
          name: this.playerName,
          color: this.colorInput.value,
          characterId: this.characterId,
          ready: true,
          connected: true,
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
        }],
        chaosModifierIds: this.chaosModifierIds,
      },
    }));
  }

  private async joinRoom() {
    if (!this.roomClient) {
      return;
    }
    const code = this.codeInput.value.trim().toUpperCase();
    if (!code) {
      this.setStatus("Enter a room code first.");
      return;
    }
    this.setBusy(true);
    try {
      const handle = await this.roomClient.joinRoom({
        code,
        playerId: this.playerId,
        name: this.playerName,
        color: this.colorInput.value,
        characterId: this.characterId,
      });
      this.activateRoom(handle);
      this.setStatus(`Joined room ${handle.code}.`);
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
    if (!this.roomClient || !this.currentRoom) return;
    const roomId = this.currentRoom.roomId;
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = undefined;
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.roomStatusBadge?.destroy();
    this.roomStatusBadge = undefined;
    this.currentRoom = undefined;
    this.currentSnapshot = null;
    this.launchedMatchId = undefined;
    this.pendingMapId = null;
    this.activeRoomBox.hidden = true;
    this.activeCode.textContent = "------";
    this.mapPicker?.setHostMode(false);
    this.mapPicker?.setSelected(undefined);
    this.renderPlayers([]);
    this.syncButtons();
    this.setStatus("Left room.", true);
    document.title = "JAKESJAM";
    window.dispatchEvent(new CustomEvent("jakesjam:room-left"));
    try {
      await this.roomClient.leave(roomId, this.playerId);
    } catch {
      // Fire-and-forget: player is gone from the UI already.
    }
  }

  private activateRoom(handle: RoomHandle) {
    this.currentRoom = handle;
    this.activeRoomBox.hidden = false;
    this.activeCode.textContent = handle.code;
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = this.roomClient?.subscribeRoom(
      handle.roomId,
      (snapshot) => this.applySnapshot(snapshot),
      (error) => this.setStatus(readError(error)),
    );

    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = window.setInterval(() => {
      void this.roomClient?.heartbeat(handle.roomId, this.playerId);
    }, 15000);
    void this.roomClient?.heartbeat(handle.roomId, this.playerId);

    // Auto-assign a distinct color if this player is new to the room (item 10).
    // We detect "new" by checking if localStorage has no saved color yet.
    if (!localStorage.getItem(PLAYER_COLOR_KEY)) {
      const assignedColor = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
      this.colorInput.value = assignedColor ?? "#50e3c2";
      localStorage.setItem(PLAYER_COLOR_KEY, this.colorInput.value);
    }

    document.title = `JAKESJAM — Lobby ${handle.code}`;
    window.dispatchEvent(new CustomEvent("jakesjam:room-joined", { detail: { code: handle.code } }));
    this.syncButtons();
  }

  private applySnapshot(snapshot: RoomSnapshot | null) {
    this.currentSnapshot = snapshot;
    if (snapshot) {
      this.applyAuthoritativeChaos(snapshot.room.chaosModifierIds ?? []);
      const isHost = snapshot.room.hostPlayerId === this.playerId;
      this.mapPicker?.setHostMode(isHost);
      // Server selection wins once it arrives, otherwise honor the
      // host's local pending pick, otherwise fall back to default.
      const serverSelected = snapshot.room.selectedMapId;
      if (serverSelected !== undefined) {
        // Sync caught up — drop the local override.
        this.pendingMapId = null;
      }
      this.mapPicker?.setSelected(
        serverSelected ?? this.pendingMapId ?? DEFAULT_MAP_ID,
      );

      // Auto-assign distinct color from palette if there's a collision (item 10).
      this.maybeResolveColorCollision(snapshot.players);
    } else {
      this.mapPicker?.setHostMode(false);
      this.mapPicker?.setSelected(undefined);
    }
    this.syncRoomStatusBadge(snapshot);
    this.renderPlayers(snapshot?.players ?? []);
    if (
      snapshot?.room.status === "in_match" &&
      snapshot.room.currentMatchId &&
      snapshot.room.currentMatchId !== this.launchedMatchId
    ) {
      this.launchedMatchId = snapshot.room.currentMatchId;
      const mapName =
        mapsById[(snapshot.room.selectedMapId ?? DEFAULT_MAP_ID) as MapId]?.name ??
        "the arena";
      this.setStatus(`Match starting in ${mapName}.`);
      window.dispatchEvent(new CustomEvent("jakesjam:start-match", {
        detail: {
          roomId: snapshot.room._id,
          roomCode: snapshot.room.code,
          matchId: snapshot.room.currentMatchId,
          localPlayerId: this.playerId,
          players: snapshot.players,
          chaosModifierIds: snapshot.room.chaosModifierIds ?? [],
        },
      }));
    }
    this.syncButtons();
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

  private async toggleReady() {
    if (!this.roomClient || !this.currentRoom) {
      return;
    }
    const currentPlayer = this.currentSnapshot?.players.find(
      (player) => player.playerId === this.playerId,
    );
    await this.roomClient.setReady(this.currentRoom.roomId, this.playerId, !currentPlayer?.ready);
  }

  private async startMatch() {
    if (!this.roomClient || !this.currentRoom) {
      return;
    }
    try {
      const mapId =
        this.currentSnapshot?.room.selectedMapId ??
        this.pendingMapId ??
        DEFAULT_MAP_ID;
      await this.roomClient.startMatch(this.currentRoom.roomId, this.playerId, mapId);
    } catch (error) {
      this.setStatus(readError(error));
    }
  }

  /**
   * Drives the per-room MatchStatusBadge: spins one up when a match is
   * active, tears it down when we return to lobby. Polls the bun
   * server's `/match/summary` endpoint with the current match id.
   * Other players in the room can see the same badge — useful for
   * "the host is mid-round, hop in when the round-over banner shows".
   */
  private syncRoomStatusBadge(snapshot: RoomSnapshot | null): void {
    const mount = this.roomStatusMount;
    if (!mount) return;
    const matchId = snapshot?.room.currentMatchId;
    if (!matchId) {
      this.roomStatusBadge?.destroy();
      this.roomStatusBadge = undefined;
      return;
    }
    if (this.roomStatusBadge) return; // already mounted for this match
    this.roomStatusBadge = new MatchStatusBadge({
      mount,
      title: "Match Status",
      shareUrl: this.buildRoomShareUrl(snapshot?.room.code),
      fetchSummary: () => fetchMatchSummary(matchId),
      // Returning players auto-rejoin via the existing in-match flow;
      // explicit "Join" is only needed for fresh links.
      onJoin: null,
    });
  }

  private buildRoomShareUrl(code: string | undefined): string | null {
    if (!code) return null;
    const base = `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}`;
    return `${base}/?room=${encodeURIComponent(code)}`;
  }

  private async copyRoomShareLink(): Promise<void> {
    const code = this.currentSnapshot?.room.code;
    if (!code || !this.roomShareBtn) return;
    const url = this.buildRoomShareUrl(code);
    if (!url) return;
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
  private async onMapPicked(mapId: MapId) {
    if (!this.roomClient || !this.currentRoom) return;
    if (!(mapId in mapsById)) return;
    // Optimistic local update so the host sees the highlight flip
    // immediately, even if the Convex sync below is degraded
    // (server down, codegen lagging, etc.). startMatch honours the
    // local pick via this.pendingMapId.
    this.pendingMapId = mapId;
    this.mapPicker?.setSelected(mapId);
    try {
      await this.roomClient.setMap(this.currentRoom.roomId, this.playerId, mapId);
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

      row.className = "player-row";
      swatch.className = "player-swatch";
      swatch.style.background = player.color;
      name.className = "player-name";
      name.textContent = `${player.name} / ${characterLabel(player.characterId)}`;
      state.className = player.ready ? "player-state ready" : "player-state";
      state.textContent = player.ready ? "Ready" : "Waiting";

      row.append(swatch, name, state);
      this.playerList.append(row);
    }
  }

  private syncButtons() {
    const hasClient = Boolean(this.roomClient);
    const hasRoom = Boolean(this.currentRoom);
    const currentPlayer = this.currentSnapshot?.players.find(
      (player) => player.playerId === this.playerId,
    );
    const players = this.currentSnapshot?.players ?? [];
    const allReady = players.length >= 1 && players.every((player) => player.ready);
    const isHost = this.currentSnapshot?.room.hostPlayerId === this.playerId;

    // Items 3: hide create/join/connect sections when in a room; show otherwise.
    if (this.roomActionsBox) {
      this.roomActionsBox.hidden = hasRoom;
    }
    if (this.playerConnectBox) {
      this.playerConnectBox.hidden = hasRoom;
    }

    // These only matter when their parent sections are visible.
    this.createButton.disabled = !hasClient || hasRoom;
    this.joinButton.disabled = !hasClient || hasRoom;
    this.readyButton.disabled = !hasClient || !hasRoom;
    this.startButton.disabled = !hasClient || !hasRoom || !isHost || !allReady;

    // Ready button: label = STATE (not action verb). Toggle via filled vs
    // outlined visual + a checkmark. Removes the "Unready button means I'm
    // unready or the button unreadies me?" confusion.
    const isReady = Boolean(currentPlayer?.ready);
    this.readyButton.textContent = isReady ? "✓  Ready" : "Mark Ready";
    this.readyButton.dataset.ready = isReady ? "true" : "false";
    this.readyButton.setAttribute("aria-pressed", isReady ? "true" : "false");

    // Surface WHY Start is disabled — the most-asked lobby question is
    // "the button's grey, what am I missing." Status line is the cheap fix.
    if (hasRoom && isHost) {
      const notReady = players.filter((p) => !p.ready);
      if (players.length < 1) {
        this.setStartHint("Need at least one player to start.");
      } else if (notReady.length > 0) {
        const names = notReady.map((p) => p.name).join(", ");
        // Item 6: single-player rooms — the host IS the unready player.
        const isSoloHost = players.length === 1 && notReady.length === 1 && notReady[0]?.playerId === this.playerId;
        if (isSoloHost) {
          this.setStartHint("Mark yourself ready first.");
        } else {
          this.setStartHint(`Waiting on: ${names}`);
        }
      } else {
        this.setStartHint("Everyone ready — start when you like.");
      }
    } else if (hasRoom && !isHost) {
      this.setStartHint("Only the host can start the match.");
    } else {
      this.setStartHint("");
    }

    // Chaos modifiers are room-wide settings — only the room host can edit them.
    // Outside a room everyone can preview their default selection.
    for (const input of this.chaosInputs) {
      input.disabled = hasRoom && !isHost;
    }
  }

  private setStartHint(message: string): void {
    let hint = this.startButton.parentElement?.querySelector<HTMLElement>(
      "[data-start-hint]",
    );
    if (!hint && this.startButton.parentElement) {
      hint = document.createElement("div");
      hint.dataset.startHint = "true";
      Object.assign(hint.style, {
        fontSize: "11px",
        color: "#7a8aa3",
        marginTop: "4px",
        letterSpacing: "0.04em",
      });
      this.startButton.parentElement.appendChild(hint);
    }
    if (hint) hint.textContent = message;
  }

  private setBusy(isBusy: boolean) {
    this.createButton.disabled = isBusy;
    this.joinButton.disabled = isBusy;
    this.readyButton.disabled = isBusy;
    this.startButton.disabled = isBusy;
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
    if (this.statusClearTimer) {
      window.clearTimeout(this.statusClearTimer);
      this.statusClearTimer = undefined;
    }
    this.statusLine.textContent = message;
    this.statusLine.style.color = "";
    if (transient) {
      this.statusClearTimer = window.setTimeout(() => {
        this.statusLine.textContent = this.currentRoom
          ? `In room ${this.currentRoom.code}.`
          : "Create or join a room.";
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
      this.statusLine.textContent = this.currentRoom
        ? `In room ${this.currentRoom.code}.`
        : "Create or join a room.";
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
    if (this.currentRoom && this.roomClient) {
      const isHost = this.currentSnapshot?.room.hostPlayerId === this.playerId;
      if (isHost) {
        void this.roomClient.updateSettings(
          this.currentRoom.roomId,
          this.playerId,
          chaosModifierIds,
        ).catch((error) => this.setErrorStatus(readError(error)));
      }
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

  const playerId = crypto.randomUUID();
  sessionStorage.setItem(PLAYER_ID_KEY, playerId);
  return playerId;
}

function readError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected lobby error.";
}

/**
 * Last-resort fallback so the Vite bundle always has *some* Convex URL,
 * even when prod env vars get lost (recurring "Set VITE_CONVEX_URL to
 * enable rooms" symptom). Points at the project's dev deployment for
 * jake-colson/jakesjam — fine for game-jam scale; swap once a separate
 * prod deployment exists. Override at runtime via `?convex=<url>` query
 * param, or at build time via VITE_CONVEX_URL / CONVEX_URL env vars
 * (vite.config.ts envPrefix accepts both).
 */
const CONVEX_URL_FALLBACK = "https://wry-kangaroo-531.convex.cloud";

function readConvexUrl(): string | undefined {
  const urlOverride = new URLSearchParams(window.location.search).get("convex");
  if (urlOverride) {
    return urlOverride;
  }

  return (
    import.meta.env.VITE_CONVEX_URL ??
    import.meta.env.CONVEX_URL ??
    CONVEX_URL_FALLBACK
  );
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
