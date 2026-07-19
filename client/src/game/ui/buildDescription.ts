import { crystalRoundsCards } from "../../sim/data/cards.js";
import { classIdForArchetype } from "../../sim/data/cardTypes.js";
import { createWeaponBuild, findCardsById } from "../../sim/data/weaponBuild.js";
import { baseWeaponForClass } from "../../sim/data/weapons.js";
import type { CharacterArchetype } from "../../sim/types.js";

export type BuildDescription = {
  title: string;
  summary: string;
  cardCount: number;
};

export function describeBuild(
  cardIds: readonly string[],
  characterId: CharacterArchetype = "balanced",
): BuildDescription {
  const cards = findCardsById(crystalRoundsCards, [...cardIds]);
  const classId = classIdForArchetype(characterId);
  const build = createWeaponBuild(baseWeaponForClass(classId), cards, classId);

  const shot = describeShot(build.delivery, build.projectile.count);
  const effects: string[] = [];
  const pathing = build.projectile.pathing;
  if (pathing === "homing") effects.push("homes toward targets");
  else if (pathing === "bounce" || build.projectile.bounces > 0) effects.push("bounces off surfaces");
  else if (pathing === "boomerang") effects.push("returns like a boomerang");
  else if (pathing === "gravity") effects.push("falls in a heavy arc");
  else if (pathing === "float") effects.push("floats through space");
  else if (pathing === "accelerate") effects.push("accelerates in flight");

  const elementEffect: Partial<Record<typeof build.projectile.element, string>> = {
    fire: "burns targets",
    ice: "slows with ice",
    lightning: "chains lightning",
    void: "carries void energy",
    radiant: "carries radiant energy",
    sticky: "sticks to targets",
    explosive: "detonates on contact",
  };
  const element = elementEffect[build.projectile.element];
  if (element) effects.push(element);

  if (build.projectile.impact === "explosive" && !effects.includes("detonates on contact")) {
    effects.push("explodes on impact");
  } else if (build.projectile.impact === "sticky" && !effects.includes("sticks to targets")) {
    effects.push("sticks before triggering");
  } else if (build.projectile.impact === "pierce-chain") {
    effects.push("pierces into another target");
  } else if (build.projectile.impact === "slow-field") {
    effects.push("leaves a slowing field");
  }
  if (build.projectile.splitCount > 0) effects.push(`splits into ${build.projectile.splitCount + 1}`);
  if (build.projectile.pierceCount > 0) effects.push(`pierces ${build.projectile.pierceCount} target${build.projectile.pierceCount === 1 ? "" : "s"}`);

  let summary = `Your attacks fire ${shot}${effects.length > 0 ? ` that ${joinNatural(effects)}` : ""}.`;
  const extras: string[] = [];
  if (build.moveSpeedMultiplier >= 1.12) extras.push("move faster");
  if (build.airJumps > 0) extras.push(`gain ${build.airJumps} extra air jump${build.airJumps === 1 ? "" : "s"}`);
  if (build.dashCharges > 0) extras.push(`gain ${build.dashCharges} dash charge${build.dashCharges === 1 ? "" : "s"}`);
  if (build.maxHealthAdd > 0) extras.push(`gain ${Math.round(build.maxHealthAdd)} max health`);
  if (build.mirrorShield) extras.push("reflect shots with your shield");
  if (build.actives.length > 0) extras.push(`carry ${build.actives.length} drafted active ${build.actives.length === 1 ? "ability" : "abilities"}`);
  if (extras.length > 0) summary += ` You also ${joinNatural(extras)}.`;

  return {
    title: cards.length > 0 ? cards.map((card) => card.name).join(" + ") : "Starter build",
    summary,
    cardCount: cards.length,
  };
}

function describeShot(delivery: string, count: number): string {
  const countWord = count === 1 ? "a single" : count === 2 ? "a two-shot" : count === 3 ? "a three-shot" : `a ${count}-shot`;
  if (delivery === "continuous-beam") return "a continuous beam";
  if (delivery === "raycast") return `${countWord} instant beam`;
  if (delivery === "area-pulse") return "an area pulse";
  return count === 1 ? "a single projectile" : `${countWord} volley`;
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
