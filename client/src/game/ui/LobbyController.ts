import { RoomClient, createRoomArgs } from "../net/RoomClient";
import type { ChaosModifierId, CharacterId } from "../types/game";
import type { RoomHandle, RoomPlayer, RoomSnapshot } from "../types/net";

const PLAYER_ID_KEY = "jakesjam.playerId";
const PLAYER_NAME_KEY = "jakesjam.playerName";
const PLAYER_COLOR_KEY = "jakesjam.playerColor";
const PLAYER_CHARACTER_KEY = "jakesjam.playerCharacter";
const CHAOS_MODIFIERS_KEY = "jakesjam.chaosModifiers";
const CLIENT_ROLE_KEY = "jakesjam.clientRole";
const DEFAULT_CHARACTER: CharacterId = "balanced";
type ClientRole = "host" | "player";

export class LobbyController {
  private readonly playerId: string;
  private readonly statusLine: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly colorInput: HTMLInputElement;
  private readonly characterSelect: HTMLSelectElement;
  private readonly characterField: HTMLElement;
  private readonly codeInput: HTMLInputElement;
  private readonly roleInputs: HTMLInputElement[];
  private readonly hostAddressInput: HTMLInputElement;
  private readonly hostPortInput: HTMLInputElement;
  private readonly joinHostInput: HTMLInputElement;
  private readonly joinPortInput: HTMLInputElement;
  private readonly serverPanel: HTMLElement;
  private readonly playerConnectPanel: HTMLElement;
  private readonly hostActions: HTMLElement;
  private readonly hostSettings: HTMLElement;
  private readonly practiceButton: HTMLButtonElement;
  private readonly createButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly readyButton: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly activeRoomBox: HTMLElement;
  private readonly activeCode: HTMLElement;
  private readonly playerList: HTMLUListElement;
  private readonly chaosInputs: HTMLInputElement[];
  private readonly roomClient?: RoomClient;
  private currentRoom?: RoomHandle;
  private currentSnapshot: RoomSnapshot | null = null;
  private unsubscribeRoom?: () => void;
  private heartbeatTimer?: number;
  private launchedMatchId?: string;
  private clientRole: ClientRole = "player";

  constructor(root: ParentNode) {
    this.playerId = loadOrCreatePlayerId();
    this.statusLine = queryRequired(root, "[data-status]");
    this.nameInput = queryRequired(root, "[data-player-name]");
    this.colorInput = queryRequired(root, "[data-player-color]");
    this.characterSelect = queryRequired(root, "[data-player-character]");
    this.characterField = queryRequired(root, "[data-character-field]");
    this.codeInput = queryRequired(root, "[data-room-code]");
    this.roleInputs = Array.from(root.querySelectorAll<HTMLInputElement>("[data-client-role]"));
    this.hostAddressInput = queryRequired(root, "[data-host-address]");
    this.hostPortInput = queryRequired(root, "[data-host-port]");
    this.joinHostInput = queryRequired(root, "[data-join-host]");
    this.joinPortInput = queryRequired(root, "[data-join-port]");
    this.serverPanel = queryRequired(root, "[data-server-panel]");
    this.playerConnectPanel = queryRequired(root, "[data-player-connect]");
    this.hostActions = queryRequired(root, "[data-host-actions]");
    this.hostSettings = queryRequired(root, "[data-host-settings]");
    this.practiceButton = queryRequired(root, "[data-practice]");
    this.createButton = queryRequired(root, "[data-create-room]");
    this.joinButton = queryRequired(root, "[data-join-room]");
    this.readyButton = queryRequired(root, "[data-ready-toggle]");
    this.startButton = queryRequired(root, "[data-start-match]");
    this.activeRoomBox = queryRequired(root, "[data-active-room]");
    this.activeCode = queryRequired(root, "[data-active-code]");
    this.playerList = queryRequired(root, "[data-player-list]");
    this.chaosInputs = Array.from(root.querySelectorAll<HTMLInputElement>("[data-chaos-modifier]"));

    this.nameInput.value = localStorage.getItem(PLAYER_NAME_KEY) ?? `Player ${this.playerId.slice(-4)}`;
    this.colorInput.value = localStorage.getItem(PLAYER_COLOR_KEY) ?? this.colorInput.value;
    this.characterSelect.value = localStorage.getItem(PLAYER_CHARACTER_KEY) ?? DEFAULT_CHARACTER;
    this.clientRole = readClientRole();
    for (const input of this.roleInputs) {
      input.checked = input.value === this.clientRole;
    }
    this.syncConnectionFieldsFromLocation();
    this.restoreRoomCodeFromUrl();
    this.restoreChaosModifiers();

    const convexUrl = readConvexUrl();
    if (convexUrl) {
      this.roomClient = new RoomClient(convexUrl);
      this.setRoleStatus();
    } else {
      this.setStatus("Run npm run dev:convex to enable hosted rooms.");
    }

    this.bindEvents();
    this.syncButtons();
  }

  destroy() {
    this.unsubscribeRoom?.();
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
    }
    if (this.roomClient && this.currentRoom) {
      void this.roomClient.leave(this.currentRoom.roomId, this.playerId);
    }
    void this.roomClient?.close();
  }

  openHostMenu() {
    this.setClientRole("host");
    this.scrollPanelIntoView(this.serverPanel);
  }

  openJoinMenu() {
    this.setClientRole("player");
    this.scrollPanelIntoView(this.playerConnectPanel);
  }

  startPracticeFromMenu() {
    this.setClientRole("host");
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
    for (const input of this.roleInputs) {
      input.addEventListener("change", () => {
        if (input.checked) {
          this.setClientRole(input.value as ClientRole);
        }
      });
    }
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
    if (this.clientRole !== "host") {
      this.setStatus("Switch to Host client to create a room.");
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
      this.setStatus("Server hosted. Share the IP, port, and room code.");
    } catch (error) {
      this.setStatus(readError(error));
    } finally {
      this.setBusy(false);
    }
  }

  private startPractice() {
    if (this.clientRole !== "host") {
      this.setStatus("Practice runs from the Host client.");
      return;
    }
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
    if (this.redirectToHostClient(code)) {
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
      this.setStatus("Player client joined server room.");
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
    }
    this.renderPlayers(snapshot?.players ?? []);
    if (
      snapshot?.room.status === "in_match" &&
      snapshot.room.currentMatchId &&
      snapshot.room.currentMatchId !== this.launchedMatchId
    ) {
      this.launchedMatchId = snapshot.room.currentMatchId;
      this.setStatus("Match starting in Boxworks.");
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
      await this.roomClient.startMatch(this.currentRoom.roomId, this.playerId);
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
    const roleCanHost = this.clientRole === "host";

    this.serverPanel.hidden = !roleCanHost;
    this.hostActions.hidden = !roleCanHost;
    this.hostSettings.hidden = !roleCanHost;
    this.playerConnectPanel.hidden = roleCanHost;
    this.characterField.hidden = !roleCanHost;

    this.createButton.disabled = !hasClient || !roleCanHost;
    this.joinButton.disabled = !hasClient;
    this.practiceButton.disabled = !roleCanHost;
    this.readyButton.disabled = !hasClient || !hasRoom;
    this.startButton.disabled = !hasClient || !hasRoom || !isHost || !allReady;
    this.readyButton.textContent = currentPlayer?.ready ? "Unready" : "Ready";

    for (const input of this.chaosInputs) {
      input.disabled = !roleCanHost || (hasRoom && !isHost);
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

  private setClientRole(role: ClientRole) {
    this.clientRole = role;
    localStorage.setItem(CLIENT_ROLE_KEY, role);
    this.syncRoleInputs();
    this.syncButtons();
    this.setRoleStatus();
  }

  private syncRoleInputs() {
    for (const input of this.roleInputs) {
      input.checked = input.value === this.clientRole;
    }
  }

  private scrollPanelIntoView(element: HTMLElement) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private setRoleStatus() {
    this.setStatus(this.clientRole === "host"
      ? "Host client controls server settings and game modifiers."
      : "Player client joins with server IP, port, and room code.");
  }

  private syncConnectionFieldsFromLocation() {
    const host = import.meta.env.VITE_PUBLIC_HOST_ADDRESS || window.location.hostname || "127.0.0.1";
    const port = import.meta.env.VITE_PUBLIC_HOST_PORT ||
      window.location.port ||
      (window.location.protocol === "https:" ? "443" : "80");
    this.hostAddressInput.value = host;
    this.hostPortInput.value = port;
    this.joinHostInput.value = host;
    this.joinPortInput.value = port;
  }

  private restoreRoomCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("room") ?? params.get("code");
    if (code) {
      this.codeInput.value = code.toUpperCase().slice(0, 6);
      this.setClientRole("player");
      for (const input of this.roleInputs) {
        input.checked = input.value === "player";
      }
    }
  }

  private redirectToHostClient(code: string): boolean {
    const host = this.joinHostInput.value.trim();
    const port = this.joinPortInput.value.trim();
    if (!host || !port) {
      this.setStatus("Enter the host IP address and port.");
      return true;
    }

    const currentHost = window.location.hostname;
    const currentPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    if (host === currentHost && port === currentPort) {
      return false;
    }

    const url = new URL(window.location.href);
    url.hostname = host;
    url.port = port;
    url.searchParams.set("role", "player");
    url.searchParams.set("room", code);
    window.location.href = url.toString();
    return true;
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
  const existing = localStorage.getItem(PLAYER_ID_KEY);
  if (existing) {
    return existing;
  }
  const playerId = crypto.randomUUID();
  localStorage.setItem(PLAYER_ID_KEY, playerId);
  return playerId;
}

function readError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected lobby error.";
}

function readClientRole(): ClientRole {
  const urlRole = new URLSearchParams(window.location.search).get("role");
  if (urlRole === "host" || urlRole === "player") {
    localStorage.setItem(CLIENT_ROLE_KEY, urlRole);
    return urlRole;
  }

  const defaultRole = window.__JAKESJAM_DEFAULT_ROLE__;
  if (defaultRole === "host" || defaultRole === "player") {
    localStorage.setItem(CLIENT_ROLE_KEY, defaultRole);
    return defaultRole;
  }

  const stored = localStorage.getItem(CLIENT_ROLE_KEY);
  return stored === "host" || stored === "player" ? stored : "player";
}

function readConvexUrl(): string | undefined {
  const urlOverride = new URLSearchParams(window.location.search).get("convex");
  if (urlOverride) {
    return urlOverride;
  }

  return window.__JAKESJAM_CONVEX_URL__ ?? import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL;
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
