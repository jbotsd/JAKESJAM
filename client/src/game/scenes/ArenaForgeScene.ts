// ArenaForgeScene — in-game map editor ("like Halo Forge", Jake 2026-07-13).
//
// Place/move/resize/delete platforms, spawn points, pickups, and
// destructibles directly in the arena, with a live validateMap() readout
// and instant Test Play. WYSIWYG: reuses the exact same renderers real
// gameplay uses (PlatformLayer, CosmicArenaLayer) so nothing looks
// different between "what you built" and "what you play."
//
// Controls: left-click = place (armed tool) / select / drag-move / drag a
// selection's corner handle to resize. Space+drag or middle-drag = pan.
// Scroll = zoom. Delete/Backspace = remove selection. Esc/right-click =
// cancel the armed tool, or deselect.

import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { PlatformLayer } from "../render/PlatformPainter";
import { CosmicArenaLayer } from "../render/CosmicArenaLayer";
import { ARENA_THEMES } from "../ui/palette";
import { ArenaForgeUI, type ForgeTool, type ForgeSelection } from "../ui/ArenaForgeUI";
import { validateMap } from "../../sim/data/mapGen.js";
import { saveCustomMap } from "../../net/mapClient.js";
import type {
  MapDefinition,
  PlatformDefinition,
  PickupDefinition,
  DestructibleDefinition,
  PickupKind,
  DestructibleKind,
} from "../../sim/types.js";

type PieceType = "platform" | "spawn" | "pickup" | "destructible";
type SelectionRef = { type: PieceType; id: string } | null;
type Corner = "nw" | "ne" | "sw" | "se";

const GRID_SIZE = 8;
const HANDLE_SCREEN_PX = 10;
const SPAWN_HIT_RADIUS = 20;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

export class ArenaForgeScene extends Phaser.Scene {
  /** Survives a Test Play round-trip (module-level, not scene-instance —
   *  the scene itself gets torn down when MatchScene starts on top of it). */
  private static lastDraft: MapDefinition | null = null;

  private map!: MapDefinition;
  private nextId = 1;
  private ui!: ArenaForgeUI;
  private platformLayer: PlatformLayer | null = null;
  private cosmicArena: CosmicArenaLayer | null = null;
  private pieceGraphics!: Phaser.GameObjects.Graphics;

  private tool: ForgeTool = "select";
  private toolKind: PickupKind | DestructibleKind | undefined;
  private selection: SelectionRef = null;
  private gridSnap = true;
  private dragging: { kind: "move" | "resize"; corner?: Corner } | null = null;

  private camZoom = 0.55;
  private camX = 0;
  private camY = 0;
  private panning = false;
  private lastPointerScreen = { x: 0, y: 0 };
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private validateDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super(SceneKeys.ArenaForge);
  }

  create() {
    this.map = ArenaForgeScene.lastDraft ?? this.buildStartingMap();
    this.nextId = this.computeNextId();
    this.camX = this.map.size.x / 2;
    this.camY = this.map.size.y / 2;
    this.selection = null;
    this.tool = "select";
    this.gridSnap = true;

    const cam = this.cameras.main;
    cam.setZoom(this.camZoom);
    cam.centerOn(this.camX, this.camY);
    cam.setRoundPixels(false);

    this.cosmicArena = new CosmicArenaLayer(this);
    this.cosmicArena.spawn(this.map.size.x, this.map.size.y);
    this.platformLayer = new PlatformLayer(this);
    this.pieceGraphics = this.add.graphics().setDepth(20);

    this.ui = new ArenaForgeUI({
      onToolChange: (tool, kind) => {
        this.tool = tool;
        this.toolKind = kind;
        this.selectPiece(null);
      },
      onFieldChange: (field, value) => this.applyFieldChange(field, value),
      onDeleteSelection: () => this.deleteSelection(),
      onTestPlay: () => this.testPlay(),
      onGridSnapToggle: (enabled) => {
        this.gridSnap = enabled;
      },
      onBack: () => this.exitToMenu(),
      onSave: () => this.saveMap(),
    });

    this.input.mouse?.disableContextMenu();
    this.spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.input.keyboard?.on("keydown-DELETE", () => this.deleteSelection());
    this.input.keyboard?.on("keydown-BACKSPACE", () => this.deleteSelection());
    this.input.keyboard?.on("keydown-ESC", () => this.cancelToolOrSelection());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    this.repaint();
    this.revalidate();
  }

  update() {
    const cam = this.cameras.main;
    cam.setZoom(this.camZoom);
    cam.centerOn(this.camX, this.camY);
  }

  // ─── Starting state ─────────────────────────────────────────────────────

  private buildStartingMap(): MapDefinition {
    return {
      id: "forge-draft",
      name: "Untitled Arena",
      size: { x: 2000, y: 1000 },
      spawns: [
        { x: 700, y: 850 },
        { x: 1300, y: 850 },
      ],
      platforms: [
        { id: "platform-0", position: { x: 1000, y: 900 }, size: { x: 1600, y: 40 }, kind: "floor" },
      ],
      destructibles: [],
      pickups: [],
      arenaTheme: "voidVessel",
    };
  }

  private computeNextId(): number {
    let max = 0;
    for (const list of [this.map.platforms, this.map.pickups ?? [], this.map.destructibles ?? []]) {
      for (const p of list) {
        const n = Number(p.id.split("-").pop());
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max + 1;
  }

  // ─── Pointer / keyboard handlers ────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.spaceKey?.isDown || pointer.middleButtonDown()) {
      this.panning = true;
      this.lastPointerScreen = { x: pointer.x, y: pointer.y };
      return;
    }
    if (pointer.rightButtonDown()) {
      this.cancelToolOrSelection();
      return;
    }
    const wx = pointer.worldX;
    const wy = pointer.worldY;
    if (this.tool !== "select") {
      this.placePiece(this.tool, this.toolKind, wx, wy);
      return;
    }
    if (this.selection) {
      const handle = this.hitTestHandle(this.selection, wx, wy);
      if (handle) {
        this.dragging = { kind: "resize", corner: handle };
        return;
      }
    }
    const hit = this.hitTestPiece(wx, wy);
    if (hit) {
      this.selectPiece(hit);
      this.dragging = { kind: "move" };
    } else {
      this.selectPiece(null);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.panning) {
      const dx = (pointer.x - this.lastPointerScreen.x) / this.camZoom;
      const dy = (pointer.y - this.lastPointerScreen.y) / this.camZoom;
      this.camX -= dx;
      this.camY -= dy;
      this.lastPointerScreen = { x: pointer.x, y: pointer.y };
      return;
    }
    if (!this.dragging || !this.selection) return;
    const wx = this.snap(pointer.worldX);
    const wy = this.snap(pointer.worldY);
    this.applyDrag(wx, wy);
    this.repaint();
    this.scheduleRevalidate();
  }

  private onPointerUp(): void {
    this.panning = false;
    if (this.dragging) {
      this.dragging = null;
      this.revalidate();
    }
  }

  private onWheel(_pointer: unknown, _objs: unknown, _dx: number, dy: number): void {
    const factor = dy > 0 ? 0.9 : 1.1;
    this.camZoom = Phaser.Math.Clamp(this.camZoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  private cancelToolOrSelection(): void {
    if (this.tool !== "select") {
      this.tool = "select";
      this.toolKind = undefined;
      this.ui.setArmedTool("select");
    } else if (this.selection) {
      this.selectPiece(null);
    }
  }

  private snap(v: number): number {
    return this.gridSnap ? Math.round(v / GRID_SIZE) * GRID_SIZE : v;
  }

  // ─── Placement ──────────────────────────────────────────────────────────

  private placePiece(
    tool: ForgeTool,
    kind: PickupKind | DestructibleKind | undefined,
    rawX: number,
    rawY: number,
  ): void {
    const x = this.snap(rawX);
    const y = this.snap(rawY);
    if (tool === "platform-floor" || tool === "platform-wall" || tool === "platform-platform") {
      const platKind = tool.slice("platform-".length) as PlatformDefinition["kind"];
      const size = platKind === "wall" ? { x: 24, y: 160 } : { x: 160, y: 24 };
      const p: PlatformDefinition = { id: `platform-${this.nextId++}`, position: { x, y }, size, kind: platKind };
      this.map.platforms.push(p);
      this.selectPiece({ type: "platform", id: p.id });
    } else if (tool === "spawn") {
      this.map.spawns.push({ x, y });
      this.selectPiece({ type: "spawn", id: String(this.map.spawns.length - 1) });
    } else if (tool === "pickup") {
      const pickupKind = (kind as PickupKind) ?? "health-shard";
      const p: PickupDefinition = {
        id: `pickup-${this.nextId++}`,
        kind: pickupKind,
        position: { x, y },
        radius: 22,
        amount: 25,
        respawnMs: 12000,
      };
      this.map.pickups = this.map.pickups ?? [];
      this.map.pickups.push(p);
      this.selectPiece({ type: "pickup", id: p.id });
    } else if (tool === "destructible") {
      const destKind = (kind as DestructibleKind) ?? "box";
      const d: DestructibleDefinition = {
        id: `destructible-${this.nextId++}`,
        kind: destKind,
        health: 40,
        position: { x, y },
        size: { x: 30, y: 30 },
        explosive: destKind === "mine",
        flammable: destKind === "barrel",
      };
      this.map.destructibles = this.map.destructibles ?? [];
      this.map.destructibles.push(d);
      this.selectPiece({ type: "destructible", id: d.id });
    }
    this.repaint();
    this.scheduleRevalidate();
    this.tool = "select";
    this.ui.setArmedTool("select");
  }

  // ─── Lookup helpers ─────────────────────────────────────────────────────

  private findPlatform(id: string): PlatformDefinition | undefined {
    return this.map.platforms.find((p) => p.id === id);
  }
  private findPickup(id: string): PickupDefinition | undefined {
    return (this.map.pickups ?? []).find((p) => p.id === id);
  }
  private findDestructible(id: string): DestructibleDefinition | undefined {
    return (this.map.destructibles ?? []).find((d) => d.id === id);
  }
  private spawnIndex(id: string): number {
    return Number(id);
  }

  private pointInAABB(px: number, py: number, center: { x: number; y: number }, size: { x: number; y: number }): boolean {
    return Math.abs(px - center.x) <= size.x / 2 && Math.abs(py - center.y) <= size.y / 2;
  }

  private hitTestPiece(wx: number, wy: number): SelectionRef {
    const pickups = this.map.pickups ?? [];
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i]!;
      if (Phaser.Math.Distance.Between(wx, wy, p.position.x, p.position.y) <= p.radius) {
        return { type: "pickup", id: p.id };
      }
    }
    const destructibles = this.map.destructibles ?? [];
    for (let i = destructibles.length - 1; i >= 0; i--) {
      const d = destructibles[i]!;
      if (this.pointInAABB(wx, wy, d.position, d.size)) return { type: "destructible", id: d.id };
    }
    for (let i = this.map.spawns.length - 1; i >= 0; i--) {
      const s = this.map.spawns[i]!;
      if (Phaser.Math.Distance.Between(wx, wy, s.x, s.y) <= SPAWN_HIT_RADIUS) {
        return { type: "spawn", id: String(i) };
      }
    }
    for (let i = this.map.platforms.length - 1; i >= 0; i--) {
      const p = this.map.platforms[i]!;
      if (this.pointInAABB(wx, wy, p.position, p.size)) return { type: "platform", id: p.id };
    }
    return null;
  }

  private hitTestHandle(ref: SelectionRef, wx: number, wy: number): Corner | null {
    if (!ref || (ref.type !== "platform" && ref.type !== "destructible")) return null;
    const piece = ref.type === "platform" ? this.findPlatform(ref.id) : this.findDestructible(ref.id);
    if (!piece) return null;
    const hw = HANDLE_SCREEN_PX / this.camZoom;
    const corners: Array<[Corner, number, number]> = [
      ["nw", piece.position.x - piece.size.x / 2, piece.position.y - piece.size.y / 2],
      ["ne", piece.position.x + piece.size.x / 2, piece.position.y - piece.size.y / 2],
      ["sw", piece.position.x - piece.size.x / 2, piece.position.y + piece.size.y / 2],
      ["se", piece.position.x + piece.size.x / 2, piece.position.y + piece.size.y / 2],
    ];
    for (const [c, cx, cy] of corners) {
      if (Math.abs(wx - cx) <= hw && Math.abs(wy - cy) <= hw) return c;
    }
    return null;
  }

  // ─── Selection / editing ────────────────────────────────────────────────

  private selectPiece(ref: SelectionRef): void {
    this.selection = ref;
    this.ui.setSelection(this.toForgeSelection(ref));
    this.repaint();
  }

  private toForgeSelection(ref: SelectionRef): ForgeSelection {
    if (!ref) return null;
    if (ref.type === "platform") {
      const p = this.findPlatform(ref.id);
      if (!p) return null;
      return { type: "platform", id: p.id, x: p.position.x, y: p.position.y, w: p.size.x, h: p.size.y, kind: p.kind };
    }
    if (ref.type === "spawn") {
      const i = this.spawnIndex(ref.id);
      const s = this.map.spawns[i];
      if (!s) return null;
      return { type: "spawn", id: ref.id, x: s.x, y: s.y };
    }
    if (ref.type === "pickup") {
      const p = this.findPickup(ref.id);
      if (!p) return null;
      return {
        type: "pickup",
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        radius: p.radius,
        amount: p.amount,
        respawnMs: p.respawnMs,
        kind: p.kind,
      };
    }
    if (ref.type === "destructible") {
      const d = this.findDestructible(ref.id);
      if (!d) return null;
      return {
        type: "destructible",
        id: d.id,
        x: d.position.x,
        y: d.position.y,
        w: d.size.x,
        h: d.size.y,
        health: d.health,
        explosive: d.explosive,
        flammable: d.flammable,
        kind: d.kind,
      };
    }
    return null;
  }

  private applyFieldChange(field: string, value: number | string | boolean): void {
    const ref = this.selection;
    if (!ref) return;
    if (ref.type === "platform") {
      const p = this.findPlatform(ref.id);
      if (!p) return;
      if (field === "x") p.position.x = Number(value);
      else if (field === "y") p.position.y = Number(value);
      else if (field === "w") p.size.x = Math.max(GRID_SIZE, Number(value));
      else if (field === "h") p.size.y = Math.max(GRID_SIZE, Number(value));
      else if (field === "kind") p.kind = value as PlatformDefinition["kind"];
    } else if (ref.type === "spawn") {
      const i = this.spawnIndex(ref.id);
      const s = this.map.spawns[i];
      if (!s) return;
      if (field === "x") s.x = Number(value);
      else if (field === "y") s.y = Number(value);
    } else if (ref.type === "pickup") {
      const p = this.findPickup(ref.id);
      if (!p) return;
      if (field === "x") p.position.x = Number(value);
      else if (field === "y") p.position.y = Number(value);
      else if (field === "radius") p.radius = Math.max(4, Number(value));
      else if (field === "amount") p.amount = Number(value);
      else if (field === "respawnMs") p.respawnMs = Math.max(0, Number(value));
      else if (field === "kind") p.kind = value as PickupKind;
    } else if (ref.type === "destructible") {
      const d = this.findDestructible(ref.id);
      if (!d) return;
      if (field === "x") d.position.x = Number(value);
      else if (field === "y") d.position.y = Number(value);
      else if (field === "w") d.size.x = Math.max(GRID_SIZE, Number(value));
      else if (field === "h") d.size.y = Math.max(GRID_SIZE, Number(value));
      else if (field === "health") d.health = Math.max(1, Number(value));
      else if (field === "explosive") d.explosive = Boolean(value);
      else if (field === "flammable") d.flammable = Boolean(value);
      else if (field === "kind") d.kind = value as DestructibleKind;
    }
    this.repaint();
    this.scheduleRevalidate();
    this.ui.setSelection(this.toForgeSelection(this.selection));
  }

  private applyDrag(wx: number, wy: number): void {
    const ref = this.selection;
    if (!ref || !this.dragging) return;
    if (this.dragging.kind === "move") {
      if (ref.type === "platform") {
        const p = this.findPlatform(ref.id);
        if (p) {
          p.position.x = wx;
          p.position.y = wy;
        }
      } else if (ref.type === "spawn") {
        const i = this.spawnIndex(ref.id);
        const s = this.map.spawns[i];
        if (s) {
          s.x = wx;
          s.y = wy;
        }
      } else if (ref.type === "pickup") {
        const p = this.findPickup(ref.id);
        if (p) {
          p.position.x = wx;
          p.position.y = wy;
        }
      } else if (ref.type === "destructible") {
        const d = this.findDestructible(ref.id);
        if (d) {
          d.position.x = wx;
          d.position.y = wy;
        }
      }
      this.ui.setSelection(this.toForgeSelection(ref));
      return;
    }
    // Resize — platforms/destructibles only (hitTestHandle already gates this).
    const corner = this.dragging.corner!;
    const piece = ref.type === "platform" ? this.findPlatform(ref.id) : this.findDestructible(ref.id);
    if (!piece) return;
    let left = piece.position.x - piece.size.x / 2;
    let right = piece.position.x + piece.size.x / 2;
    let top = piece.position.y - piece.size.y / 2;
    let bottom = piece.position.y + piece.size.y / 2;
    if (corner === "nw") {
      left = wx;
      top = wy;
    } else if (corner === "ne") {
      right = wx;
      top = wy;
    } else if (corner === "sw") {
      left = wx;
      bottom = wy;
    } else {
      right = wx;
      bottom = wy;
    }
    const w = Math.max(GRID_SIZE, right - left);
    const h = Math.max(GRID_SIZE, bottom - top);
    piece.size = { x: w, y: h };
    piece.position = { x: (left + right) / 2, y: (top + bottom) / 2 };
    this.ui.setSelection(this.toForgeSelection(ref));
  }

  private deleteSelection(): void {
    const ref = this.selection;
    if (!ref) return;
    if (ref.type === "platform") {
      this.map.platforms = this.map.platforms.filter((p) => p.id !== ref.id);
    } else if (ref.type === "spawn") {
      this.map.spawns.splice(this.spawnIndex(ref.id), 1);
    } else if (ref.type === "pickup") {
      this.map.pickups = (this.map.pickups ?? []).filter((p) => p.id !== ref.id);
    } else if (ref.type === "destructible") {
      this.map.destructibles = (this.map.destructibles ?? []).filter((d) => d.id !== ref.id);
    }
    this.selectPiece(null);
    this.revalidate();
  }

  // ─── Rendering ──────────────────────────────────────────────────────────

  private repaint(): void {
    const themeKey = (this.map.arenaTheme ?? "voidVessel") as keyof typeof ARENA_THEMES;
    const theme = ARENA_THEMES[themeKey];
    this.platformLayer?.repaint(this.map.platforms, theme);

    const g = this.pieceGraphics;
    g.clear();

    g.fillStyle(0x8ff8ff, 0.55);
    for (const s of this.map.spawns) g.fillCircle(s.x, s.y, 6);

    g.lineStyle(1.5, 0xffd76b, 0.75);
    g.fillStyle(0xffd76b, 0.5);
    for (const p of this.map.pickups ?? []) {
      g.fillCircle(p.position.x, p.position.y, Math.max(3, p.radius * 0.35));
      g.strokeCircle(p.position.x, p.position.y, p.radius);
    }

    g.lineStyle(1.5, 0xfb7185, 0.85);
    g.fillStyle(0xfb7185, 0.3);
    for (const d of this.map.destructibles ?? []) {
      g.fillRect(d.position.x - d.size.x / 2, d.position.y - d.size.y / 2, d.size.x, d.size.y);
      g.strokeRect(d.position.x - d.size.x / 2, d.position.y - d.size.y / 2, d.size.x, d.size.y);
    }

    if (this.selection) {
      const sel = this.toForgeSelection(this.selection);
      if (sel) {
        g.lineStyle(2, 0x8ff8ff, 1);
        if (sel.type === "platform" || sel.type === "destructible") {
          g.strokeRect(sel.x - sel.w / 2 - 3, sel.y - sel.h / 2 - 3, sel.w + 6, sel.h + 6);
          const hw = HANDLE_SCREEN_PX / this.camZoom / 2;
          g.fillStyle(0x8ff8ff, 1);
          const corners: Array<[number, number]> = [
            [sel.x - sel.w / 2, sel.y - sel.h / 2],
            [sel.x + sel.w / 2, sel.y - sel.h / 2],
            [sel.x - sel.w / 2, sel.y + sel.h / 2],
            [sel.x + sel.w / 2, sel.y + sel.h / 2],
          ];
          for (const [cx, cy] of corners) g.fillRect(cx - hw, cy - hw, hw * 2, hw * 2);
        } else {
          const radius = sel.type === "pickup" ? sel.radius + 4 : SPAWN_HIT_RADIUS;
          g.strokeCircle(sel.x, sel.y, radius);
        }
      }
    }
  }

  private revalidate(): void {
    this.ui.setValidation(validateMap(this.map));
  }

  private scheduleRevalidate(): void {
    if (this.validateDebounce) clearTimeout(this.validateDebounce);
    this.validateDebounce = setTimeout(() => this.revalidate(), 150);
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private testPlay(): void {
    ArenaForgeScene.lastDraft = this.map;
    // Route through the game's canonical match-entry event instead of a
    // direct scene.start() — that's what turns on the pause/exit chrome
    // (the "MENU" button → Leave, wired in main.ts's jakesjam:start-match
    // listener via ShellController's MATCH_STARTED). A direct scene.start
    // left Test Play with no way back out at all (Jake, 2026-07-13).
    window.dispatchEvent(
      new CustomEvent("jakesjam:start-match", {
        detail: { mode: "practice", map: this.map },
      }),
    );
    // The listener uses the game-level scene manager (game.scene.start),
    // which does NOT auto-stop other active scenes (only a scene's own
    // this.scene.start() does that) — stop ourselves explicitly so Forge
    // doesn't keep running (and eating input) underneath MatchScene.
    this.scene.stop();
  }

  private exitToMenu(): void {
    ArenaForgeScene.lastDraft = this.map;
    window.dispatchEvent(new CustomEvent("jakesjam:forge-exit"));
  }

  private async saveMap(): Promise<void> {
    this.ui.showSaveOutcome({ pending: true });
    const result = await saveCustomMap(this.map);
    if (!result.ok) {
      this.ui.showSaveOutcome({ pending: false, error: result.error });
      return;
    }
    // The share link prefills the private-room "load custom map by code"
    // input (LobbyController's ?map= restore) — a friend opens it, sees the
    // code ready to load, and starts a real multiplayer match on it. It
    // doesn't auto-load anything (same restraint as the existing ?room=
    // restore: prefill, never act without an explicit click).
    const shareUrl = `${window.location.origin}${window.location.pathname}?map=${result.code}`;
    this.ui.showSaveOutcome({ pending: false, code: result.code, shareUrl });
  }

  private cleanup(): void {
    this.ui?.destroy();
    this.cosmicArena?.destroy();
    this.cosmicArena = null;
    this.platformLayer?.destroy();
    this.platformLayer = null;
    if (this.validateDebounce) clearTimeout(this.validateDebounce);
    this.validateDebounce = null;
  }
}
