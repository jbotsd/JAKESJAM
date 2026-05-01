import Phaser from "phaser";
import type { Vec2 } from "../types/game";

type ProceduralPlayerRigOptions = {
  color: number;
  name: string;
  scale?: number;
};

type ProceduralPlayerPose = {
  position: Vec2;
  velocity: Vec2;
  aimTarget: Vec2;
  grounded: boolean;
  crouching: boolean;
};

type LimbSolve = {
  joint: Vec2;
  end: Vec2;
};

const PLAYER_WHITE = 0xf7fbff;
const PLAYER_DARK = 0x07101c;
const HEALTH_GREEN = 0xb8f05a;
const HEALTH_BACKING = 0x1f2937;

export class ProceduralPlayerRig {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly color: number;
  private readonly name: string;
  private readonly scale: number;
  private stepPhase = 0;
  private facing = 1;

  constructor(scene: Phaser.Scene, options: ProceduralPlayerRigOptions) {
    this.graphics = scene.add.graphics();
    this.nameText = scene.add
      .text(0, 0, options.name, {
        color: "#f7fbff",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: `${Math.round(10 * (options.scale ?? 1))}px`,
        fontStyle: "700",
      })
      .setOrigin(0.5, 1);
    this.color = options.color;
    this.name = options.name;
    this.scale = options.scale ?? 1;
  }

  update(deltaMs: number, pose: ProceduralPlayerPose) {
    const walkAmount = Phaser.Math.Clamp(Math.abs(pose.velocity.x) / 180, 0, 1);
    this.stepPhase += deltaMs * (0.006 + walkAmount * 0.01);

    if (Math.abs(pose.velocity.x) > 8) {
      this.facing = Math.sign(pose.velocity.x);
    } else if (Math.abs(pose.aimTarget.x - pose.position.x) > 2) {
      this.facing = Math.sign(pose.aimTarget.x - pose.position.x);
    }

    this.draw(pose, walkAmount);
  }

  destroy() {
    this.graphics.destroy();
    this.nameText.destroy();
  }

  private draw(pose: ProceduralPlayerPose, walkAmount: number) {
    const g = this.graphics;
    const s = this.scale;
    const ground = pose.position.y;
    const crouchAmount = pose.crouching ? 1 : 0;
    const bodyBob = pose.grounded && !pose.crouching
      ? Math.abs(Math.sin(this.stepPhase)) * 1.6 * walkAmount
      : 0;
    const pelvisOffset = Phaser.Math.Linear(50, 30, crouchAmount);
    const chestOffset = Phaser.Math.Linear(75, 54, crouchAmount);
    const headOffset = Phaser.Math.Linear(95, 73, crouchAmount);
    const pelvis = vec(pose.position.x, ground - (pelvisOffset + bodyBob) * s);
    const chest = vec(pose.position.x, ground - (chestOffset + bodyBob) * s);
    const head = vec(pose.position.x + this.facing * 2 * s, ground - (headOffset + bodyBob) * s);
    const aimAngle = Math.atan2(pose.aimTarget.y - chest.y, pose.aimTarget.x - chest.x);
    const aim = vec(Math.cos(aimAngle), Math.sin(aimAngle));
    const perp = vec(-aim.y, aim.x);

    const hipLeft = vec(pelvis.x - 6 * s, pelvis.y);
    const hipRight = vec(pelvis.x + 6 * s, pelvis.y);
    const shoulderLead = vec(chest.x + perp.x * 5 * s, chest.y + perp.y * 5 * s);
    const shoulderBack = vec(chest.x - perp.x * 5 * s, chest.y - perp.y * 5 * s);
    const handLead = vec(chest.x + aim.x * 31 * s, chest.y + aim.y * 31 * s);
    const handBack = vec(chest.x + aim.x * 20 * s - perp.x * 7 * s, chest.y + aim.y * 20 * s - perp.y * 7 * s);
    const gunBreech = vec(chest.x + aim.x * 17 * s, chest.y + aim.y * 17 * s);
    const muzzle = vec(chest.x + aim.x * 43 * s, chest.y + aim.y * 43 * s);

    const leftFoot = this.footTarget(pose.position, -1, ground, walkAmount, pose.crouching);
    const rightFoot = this.footTarget(pose.position, 1, ground, walkAmount, pose.crouching);
    const legBendDirection = -this.facing;
    const upperLegLength = Phaser.Math.Linear(26, 20, crouchAmount) * s;
    const lowerLegLength = Phaser.Math.Linear(27, 22, crouchAmount) * s;
    const leftLeg = solveTwoBone(hipLeft, leftFoot, upperLegLength, lowerLegLength, legBendDirection);
    const rightLeg = solveTwoBone(hipRight, rightFoot, upperLegLength, lowerLegLength, legBendDirection);
    const leadArm = solveTwoBone(shoulderLead, handLead, 17 * s, 16 * s, -this.facing);
    const backArm = solveTwoBone(shoulderBack, handBack, 16 * s, 15 * s, this.facing);

    g.clear();

    this.drawNameplate(g, head.x, head.y - 20 * s, s);
    this.drawLimb(g, hipLeft, leftLeg, 5 * s);
    this.drawLimb(g, hipRight, rightLeg, 5 * s);
    this.drawFoot(g, leftFoot, s);
    this.drawFoot(g, rightFoot, s);

    g.lineStyle(6 * s, PLAYER_DARK, 1);
    g.beginPath();
    g.moveTo(pelvis.x, pelvis.y);
    g.lineTo(chest.x, chest.y);
    g.strokePath();

    g.lineStyle(5 * s, this.color, 1);
    g.beginPath();
    g.moveTo(pelvis.x, pelvis.y);
    g.lineTo(chest.x, chest.y);
    g.strokePath();

    this.drawLimb(g, shoulderBack, backArm, 4 * s);
    this.drawGun(g, gunBreech, muzzle, s);
    this.drawLimb(g, shoulderLead, leadArm, 4 * s);

    g.fillStyle(this.color, 1);
    g.fillCircle(head.x, head.y, 12 * s);
    g.lineStyle(3 * s, PLAYER_DARK, 1);
    g.strokeCircle(head.x, head.y, 12 * s);
    this.drawFace(g, head, s);
  }

  private footTarget(
    position: Vec2,
    side: -1 | 1,
    ground: number,
    walkAmount: number,
    crouching: boolean,
  ): Vec2 {
    const s = this.scale;
    const cycle = this.stepPhase + (side === -1 ? 0 : Math.PI);
    const stride = (crouching ? 10 : 17) * s * walkAmount;
    const lift = Math.max(0, Math.sin(cycle)) * (crouching ? 4 : 7) * s * walkAmount;
    const idleSpread = (crouching ? 7 : 5) * s;
    const footX = position.x + side * idleSpread - Math.cos(cycle) * stride * this.facing;
    return vec(footX, ground - lift);
  }

  private drawLimb(
    graphics: Phaser.GameObjects.Graphics,
    root: Vec2,
    solve: LimbSolve,
    width: number,
  ) {
    graphics.lineStyle(width + 2, PLAYER_DARK, 1);
    graphics.beginPath();
    graphics.moveTo(root.x, root.y);
    graphics.lineTo(solve.joint.x, solve.joint.y);
    graphics.lineTo(solve.end.x, solve.end.y);
    graphics.strokePath();

    graphics.lineStyle(width, this.color, 1);
    graphics.beginPath();
    graphics.moveTo(root.x, root.y);
    graphics.lineTo(solve.joint.x, solve.joint.y);
    graphics.lineTo(solve.end.x, solve.end.y);
    graphics.strokePath();
  }

  private drawFoot(graphics: Phaser.GameObjects.Graphics, foot: Vec2, scale: number) {
    graphics.lineStyle(4 * scale, PLAYER_DARK, 1);
    graphics.beginPath();
    graphics.moveTo(foot.x - this.facing * 7 * scale, foot.y);
    graphics.lineTo(foot.x + this.facing * 7 * scale, foot.y);
    graphics.strokePath();

    graphics.lineStyle(2 * scale, PLAYER_WHITE, 1);
    graphics.beginPath();
    graphics.moveTo(foot.x - this.facing * 5 * scale, foot.y - 1 * scale);
    graphics.lineTo(foot.x + this.facing * 5 * scale, foot.y - 1 * scale);
    graphics.strokePath();
  }

  private drawGun(
    graphics: Phaser.GameObjects.Graphics,
    hand: Vec2,
    muzzle: Vec2,
    scale: number,
  ) {
    graphics.lineStyle(7 * scale, PLAYER_DARK, 1);
    graphics.beginPath();
    graphics.moveTo(hand.x, hand.y);
    graphics.lineTo(muzzle.x, muzzle.y);
    graphics.strokePath();

    graphics.lineStyle(4 * scale, PLAYER_WHITE, 1);
    graphics.beginPath();
    graphics.moveTo(hand.x, hand.y);
    graphics.lineTo(muzzle.x, muzzle.y);
    graphics.strokePath();

    graphics.fillStyle(0xffd166, 1);
    graphics.fillCircle(muzzle.x, muzzle.y, 3 * scale);
  }

  private drawFace(graphics: Phaser.GameObjects.Graphics, head: Vec2, scale: number) {
    const eyeY = head.y - 2 * scale;
    graphics.fillStyle(PLAYER_DARK, 1);
    graphics.fillCircle(head.x + this.facing * 4 * scale, eyeY, 2 * scale);
    graphics.lineStyle(2 * scale, PLAYER_DARK, 1);
    graphics.beginPath();
    graphics.moveTo(head.x - this.facing * 4 * scale, head.y + 5 * scale);
    graphics.lineTo(head.x + this.facing * 6 * scale, head.y + 5 * scale);
    graphics.strokePath();
  }

  private drawNameplate(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    scale: number,
  ) {
    const nameWidth = Math.max(34, this.name.length * 6) * scale;
    graphics.fillStyle(PLAYER_DARK, 0.7);
    graphics.fillRoundedRect(x - nameWidth / 2, y - 13 * scale, nameWidth, 11 * scale, 2 * scale);
    graphics.fillStyle(PLAYER_WHITE, 1);
    graphics.fillRect(x - nameWidth / 2, y - 1 * scale, nameWidth, 3 * scale);
    graphics.fillStyle(HEALTH_GREEN, 1);
    graphics.fillRect(x - nameWidth / 2, y - 1 * scale, nameWidth * 0.78, 3 * scale);
    graphics.fillStyle(HEALTH_BACKING, 1);
    graphics.fillRect(x + nameWidth * 0.28, y - 1 * scale, nameWidth * 0.22, 3 * scale);
    this.nameText.setPosition(x, y - 2 * scale);
  }
}

function solveTwoBone(
  root: Vec2,
  target: Vec2,
  upperLength: number,
  lowerLength: number,
  bendDirection: number,
): LimbSolve {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDistance = Math.hypot(dx, dy);
  const distance = Phaser.Math.Clamp(rawDistance, 0.0001, upperLength + lowerLength - 0.0001);
  const targetAngle = Math.atan2(dy, dx);
  const jointAngle = Math.acos(
    Phaser.Math.Clamp(
      (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
        (2 * upperLength * distance),
      -1,
      1,
    ),
  );
  const upperAngle = targetAngle + jointAngle * bendDirection;
  const joint = vec(
    root.x + Math.cos(upperAngle) * upperLength,
    root.y + Math.sin(upperAngle) * upperLength,
  );

  return {
    joint,
    end: target,
  };
}

function vec(x: number, y: number): Vec2 {
  return { x, y };
}
