// RoundBanner — animated centre-screen round banner.
//
// Handles countdown (3 / 2 / 1 / FIGHT!), round-over, and inter-round beats.
// Shared by MatchScene and OnlineMatchScene.
//
// Usage:
//   const banner = new RoundBanner(scene);
//   banner.update(roundState); // called every frame
//   banner.destroy();          // on scene shutdown

import Phaser from "phaser";
import { uiWidth, uiHeight } from "../render/renderResolution.js";

export type RoundBannerState = {
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  countdownRemainingMs: number;
  roundIndex: number;
  winnerLabel?: string;
  /** Round score per player — shown as a line under the round-over banner
   *  so the point that was just scored isn't only visible in the small
   *  peripheral scoreboard column. */
  scores?: Record<string, number>;
  /** playerId → display name (hello roster); ids fall back to tags. */
  names?: Record<string, string>;
  localPlayerId?: string;
};

// Which countdown "beat" is currently showing
type CountdownBeat = "3" | "2" | "1" | "FIGHT!" | "none";

export class RoundBanner {
  private readonly scene: Phaser.Scene;

  // Main large label ("3", "2", "1", "FIGHT!", "ROUND X TO Y")
  private mainText!: Phaser.GameObjects.Text;
  // Smaller above-label ("ROUND N")
  private subText!: Phaser.GameObjects.Text;
  // Score line shown under the round-over label — the point that was just
  // scored, so it's not only visible in the small peripheral scoreboard.
  private scoreText!: Phaser.GameObjects.Text;

  private lastBeat: CountdownBeat = "none";
  private lastPhase: RoundBannerState["phase"] | "hidden" = "hidden";
  private popTween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  update(state: RoundBannerState): void {
    if (state.phase === "fighting" || state.phase === "drafting") {
      this.hide();
      return;
    }

    if (state.phase === "countdown") {
      this.updateCountdown(state.countdownRemainingMs, state.roundIndex);
      return;
    }

    if (state.phase === "round-over") {
      if (this.lastPhase !== "round-over") {
        this.showRoundOver(
          state.roundIndex,
          state.winnerLabel ?? "DRAW",
          state.scores,
          state.names,
          state.localPlayerId,
        );
      }
      return;
    }
  }

  destroy(): void {
    this.scene.scale.off("resize", this.onResize, this);
    this.popTween?.stop();
    this.mainText.destroy();
    this.subText.destroy();
    this.scoreText.destroy();
  }

  /** Explicitly clears the banner. Normally implicit (fighting/drafting
   *  phases call this from update()) — exposed so match-end can clear a
   *  frozen round-over banner before it sits underneath the results modal. */
  hide(): void {
    this.mainText.setVisible(false);
    this.subText.setVisible(false);
    this.scoreText.setVisible(false);
    this.lastPhase = "hidden";
    this.lastBeat = "none";
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private build(): void {
    const s = this.scene;
    const cx = uiWidth(s) / 2;
    // A8 (footage list): 0.32 sat the beat text on top of mid-arena rigs
    // in real spawns — lift above the platform band.
    const cy = uiHeight(s) * 0.22;

    this.subText = s.add
      .text(cx, cy - 44, "", {
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#8ff8ff",
        letterSpacing: 6,
        stroke: "#05080f",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(990)
      .setVisible(false);

    this.mainText = s.add
      .text(cx, cy, "", {
        fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
        fontSize: "72px",
        fontStyle: "900",
        color: "#fff7d6",
        stroke: "#0b0e14",
        strokeThickness: 10,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(990)
      .setVisible(false);

    this.scoreText = s.add
      .text(cx, cy + 46, "", {
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: "16px",
        fontStyle: "bold",
        color: "#8ff8ff",
        letterSpacing: 2,
        stroke: "#05080f",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(990)
      .setVisible(false);

    s.scale.on("resize", this.onResize, this);
  }

  private onResize(): void {
    const cx = uiWidth(this.scene) / 2;
    const cy = uiHeight(this.scene) * 0.32;
    this.mainText.setPosition(cx, cy);
    this.subText.setPosition(cx, cy - 44);
    this.scoreText.setPosition(cx, cy + 46);
  }

  private updateCountdown(remainingMs: number, roundIndex: number): void {
    // roundIndex is 0-based sim state; display 1-based.
    roundIndex += 1;
    let beat: CountdownBeat;
    if (remainingMs > 2400) {
      beat = "3";
    } else if (remainingMs > 1400) {
      beat = "2";
    } else if (remainingMs > 600) {
      beat = "1";
    } else {
      beat = "FIGHT!";
    }

    if (beat !== this.lastBeat || this.lastPhase !== "countdown") {
      this.lastBeat = beat;
      this.lastPhase = "countdown";

      const isFight = beat === "FIGHT!";
      const subLabel = `ROUND ${roundIndex}`;

      this.subText.setText(subLabel).setVisible(true);
      this.scoreText.setVisible(false);
      this.mainText
        .setText(beat)
        .setFontSize(isFight ? "56px" : "88px")
        .setColor(isFight ? "#8ff8ff" : "#fff7d6")
        .setVisible(true)
        .setScale(1.3, 1.3);

      this.popTween?.stop();
      this.popTween = this.scene.tweens.add({
        targets: [this.mainText],
        scaleX: 1,
        scaleY: 1,
        duration: isFight ? 420 : 260,
        ease: "Back.easeOut",
      });
    }
  }

  private showRoundOver(
    roundIndex: number,
    winnerLabel: string,
    scores?: Record<string, number>,
    names?: Record<string, string>,
    localPlayerId?: string,
  ): void {
    this.lastPhase = "round-over";
    // roundIndex is 0-based sim state; display 1-based.
    roundIndex += 1;

    const subLabel = `ROUND ${roundIndex}`;
    // "TO YOU" / "TO 3F2A" reads as "point goes to X" — but a draw is not
    // awarded to anyone, so "TO DRAW" was nonsense copy.
    const upper = winnerLabel.toUpperCase();
    const mainLabel = upper === "DRAW" ? "DRAW" : `TO ${upper}`;

    this.subText.setText(subLabel).setVisible(true);
    this.mainText
      .setText(mainLabel)
      .setFontSize("52px")
      .setColor("#fff7d6")
      .setVisible(true)
      .setScale(0.7, 0.7);

    // A3 (docs/footage-removal-list.md): the score line duplicated the
    // roster column that's on screen the whole time — two renderings of
    // the same numbers mid-screen read as clutter on tape. The banner
    // keeps the beat ("ROUND N / TO X"); the roster owns the numbers.
    void scores;
    void names;
    void localPlayerId;
    this.scoreText.setVisible(false);

    this.popTween?.stop();
    this.popTween = this.scene.tweens.add({
      targets: [this.mainText],
      scaleX: 1,
      scaleY: 1,
      duration: 380,
      ease: "Back.easeOut",
    });
  }
}
