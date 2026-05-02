import { RoomClient, createRoomArgs } from "../net/RoomClient";
import type { ChaosModifierId, CharacterId } from "../types/game";
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
  private roomStatusBadge?: MatchStatusBadge;
  private readonly roomClient?: RoomClient;
  private currentRoom?: RoomHandle;
  private currentSnapshot: RoomSnapshot | null = null;
  private unsubscribeRoom?: () => void;
  private heartbeatTimer?: number;
  private launchedMatchId?: string;

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

    this.nameInput.value = localStorage.getItem(PLAYER_NAME_KEY) ?? `Player ${this.playerId.slice(-4)}`;
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

  private bindEvents() {
    this.nameInput.addEventListener("input", () => {
      localStorage.setItem(PLAYER_NAME_KEY, this.playerName);
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
    this.syncButtons();
  }

  private applySnapshot(snapshot: RoomSnapshot | null) {
    this.currentSnapshot = snapshot;
    if (snapshot) {
      this.applyAuthoritativeChaos(snapshot.room.chaosModifierIds ?? []);
      const isHost = snapshot.room.hostPlayerId === this.playerId;
      this.mapPicker?.setHostMode(isHost);
      this.mapPicker?.setSelected(snapshot.room.selectedMapId ?? DEFAULT_MAP_ID);
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
        this.currentSnapshot?.room.selectedMapId ?? DEFAULT_MAP_ID;
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
      window.prompt("Copy this link", url);
    }
  }

  /**
   * Host clicked a card in the map picker. Persist via Convex; the
   * snapshot stream re-applies the selection through `applySnapshot`,
   * which is what visibly flips the highlighted card. We don't optimistic-
   * update locally — keeps a single source of truth.
   */
  private async onMapPicked(mapId: MapId) {
    if (!this.roomClient || !this.currentRoom) return;
    if (!(mapId in mapsById)) return;
    try {
      await this.roomClient.setMap(this.currentRoom.roomId, this.playerId, mapId);
    } catch (error) {
      this.setStatus(readError(error));
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

    this.createButton.disabled = !hasClient || hasRoom;
    this.joinButton.disabled = !hasClient || hasRoom;
    this.readyButton.disabled = !hasClient || !hasRoom;
    this.startButton.disabled = !hasClient || !hasRoom || !isHost || !allReady;
    this.readyButton.textContent = currentPlayer?.ready ? "Unready" : "Ready";

    // Chaos modifiers are room-wide settings — only the room host can edit them.
    // Outside a room everyone can preview their default selection.
    for (const input of this.chaosInputs) {
      input.disabled = hasRoom && !isHost;
    }
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

  private setStatus(message: string) {
    this.statusLine.textContent = message;
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
        ).catch((error) => this.setStatus(readError(error)));
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

function readConvexUrl(): string | undefined {
  const urlOverride = new URLSearchParams(window.location.search).get("convex");
  if (urlOverride) {
    return urlOverride;
  }

  return import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL;
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
  const raw = localStorage.getItem(CHAOS_MODIFIERS_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as ChaosModifierId[];
  } catch {
    return [];
  }
}
