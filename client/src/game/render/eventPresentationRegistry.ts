// Machine-readable Wave-0 contract for sim-event presentation.
//
// This is deliberately descriptive, not an event handler. SimEventRouter and
// the state-driven render systems still own runtime behavior. The registry
// gives orchestration/tests one exhaustive place to answer:
//   - what player-visible change closes this event's feedback loop?
//   - which channel leads and which channels confirm it?
//   - what must survive at fxLevel 0?
//   - is the current presentation complete, partial, or missing?
//
// Keep it Phaser-free so bun:test and planning tools can import it cheaply.
// Adding a SimEvent tag fails typecheck until its presentation contract is
// classified here. See docs/juice-axiom-orchestration.md.

import type { SimEvent } from "../../sim/types.js";

export type SimEventKind = SimEvent["t"];

export type PresentationIntensityTier =
  | "micro"
  | "action"
  | "hit"
  | "heavy"
  | "kill"
  | "cast"
  | "round";

export type PresentationChannel =
  | "animation"
  | "audio"
  | "camera"
  | "particles"
  | "timing"
  | "ui"
  | "world-vfx"
  | "world-state";

export type PresentationState =
  | "complete"
  | "partial"
  | "missing"
  | "structural";

export type EventPresentationContract = {
  /** Player action or world beat that caused the event. */
  action: string;
  /** The legible change a player must be able to perceive. */
  stateChange: string;
  /** Dominant feedback channel; other channels only confirm it. */
  lead: PresentationChannel;
  /** Channels currently participating in the shipped feedback stack. */
  channels: readonly PresentationChannel[];
  intensity: PresentationIntensityTier;
  /** Minimum read that must remain at fxLevel 0 / potato tier. */
  lowTierCore: string;
  /** Honest current completion classification, not design aspiration. */
  state: PresentationState;
  /** Why incomplete, or why a structural event needs no independent stack. */
  note?: string;
};

export const EVENT_PRESENTATION_REGISTRY = {
  "shot-fired": {
    action: "A player fires their weapon",
    stateChange: "The firing hand releases a visible projectile with recoil",
    lead: "animation",
    channels: ["animation", "audio", "camera", "world-vfx"],
    intensity: "action",
    lowTierCore: "Hand recoil, projectile body, and shot transient remain visible",
    state: "complete",
  },
  "hit-confirmed": {
    action: "An attack applies damage",
    stateChange: "The victim visibly reacts and the impact site confirms damage",
    lead: "world-vfx",
    channels: ["world-vfx", "animation", "audio", "timing", "ui"],
    intensity: "hit",
    lowTierCore: "Victim reaction and impact confirmation remain visible",
    state: "complete",
  },
  "destructible-broken": {
    action: "Damage destroys an arena object",
    stateChange: "The object disappears into a spatially anchored break",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "camera", "world-state"],
    intensity: "heavy",
    lowTierCore: "Object removal and one break flash remain visible",
    state: "complete",
  },
  "destructible-hit": {
    action: "Damage lands on an arena object without destroying it",
    stateChange: "A floating damage number confirms the hit at the object's position",
    lead: "ui",
    channels: ["ui", "audio"],
    intensity: "hit",
    lowTierCore: "The damage number remains visible",
    state: "partial",
    note: "Deliberately no hit-stop/camera-shake/world-vfx (a struck object shouldn't jolt the camera the way a player hit does) — 2-channel stack reads as \"partial\" against this registry's 3-channel completeness bar by construction, not because a planned channel is missing.",
  },
  "pickup-taken": {
    action: "A player collects a pickup",
    stateChange: "The pickup vanishes and the acquired state is acknowledged",
    lead: "world-state",
    channels: ["world-state", "audio"],
    intensity: "micro",
    lowTierCore: "Pickup removal remains visible",
    state: "partial",
    note: "Needs a consistent collector-side visual/UI confirmation.",
  },
  "round-end": {
    action: "The round reaches a result",
    stateChange: "Combat cadence resolves into the round-over rest beat",
    lead: "ui",
    channels: ["ui", "audio", "world-state"],
    intensity: "round",
    lowTierCore: "Winner/result and phase change remain readable",
    state: "partial",
    note: "Macro transition exists; presentation-stack evidence is not locked.",
  },
  "player-slowed": {
    action: "An attack applies slow",
    stateChange: "The victim visibly enters a slowed state",
    lead: "world-vfx",
    channels: ["world-vfx", "ui", "world-state"],
    intensity: "hit",
    lowTierCore: "A persistent non-colour-only slowed tell",
    state: "complete",
    note: "StatusVfxController renders a paired foot-level drag wake while the authoritative slow state is active.",
  },
  "parry-deflected": {
    action: "A defense turns an incoming attack",
    stateChange: "The catch and reversal register at the defender",
    lead: "animation",
    channels: ["animation", "audio", "camera", "timing", "world-vfx"],
    intensity: "heavy",
    lowTierCore: "Defender flash and reflected projectile direction remain visible",
    state: "complete",
  },
  "shield-popped": {
    action: "A shield exhausts its charge",
    stateChange: "The defensive state visibly breaks and ends",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "world-state"],
    intensity: "heavy",
    lowTierCore: "Shield-break flash and extinguished state remain visible",
    state: "complete",
  },
  "player-killed": {
    action: "Damage kills a player",
    stateChange: "The body dies and the arena receives the death beat",
    lead: "animation",
    channels: ["animation", "world-vfx", "audio", "camera", "timing", "particles"],
    intensity: "kill",
    lowTierCore: "Death state, soul mote, and killer/victim distinction remain readable",
    state: "complete",
    note: "Carries additive `executed: true` for Technique-axis execute kills — deathFxPainter adds a single horizontal severance shear at the unmake moment (all fx tiers; subtler than ascension-denial's inverted grammar).",
  },
  "first-blood": {
    action: "The first credited hit of a round lands",
    stateChange: "The wager and its beneficiary become legible",
    lead: "ui",
    channels: ["audio", "world-state"],
    intensity: "heavy",
    lowTierCore: "The buffed player is identifiable without relying on colour alone",
    state: "partial",
    note: "Audio exists; beneficiary/world read needs completion evidence.",
  },
  "emission-cast": {
    action: "A fully charged player casts Emission",
    stateChange: "The vessel presses its seal and releases the composed hand",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "camera", "world-state"],
    intensity: "cast",
    lowTierCore: "Seal flash, volley origin, and charge consumption remain readable",
    state: "complete",
  },
  "stride-refunded": {
    action: "A Stride-charged Emission cast refunds spent air movement",
    stateChange: "The caster's air jump/dash visibly come back at the body",
    lead: "world-vfx",
    channels: ["world-vfx", "particles", "world-state"],
    intensity: "action",
    lowTierCore: "One upward-sweeping ring at the feet remains visible",
    state: "complete",
    note: "StatusVfxController renders an upward-sweeping feet-level ring burst plus rising tick sparks (movement register — rises where slow's drag wake sinks); the refunded jump/dash being usable again is the world-state confirmation. Deliberately silent (no canonical cue recorded; the same-tick emission-cast carries the audio).",
  },
  "ability-activated": {
    action: "A player activates a drafted ability",
    stateChange: "The press, ability identity, and cooldown start register",
    lead: "world-vfx",
    channels: ["animation", "audio", "camera", "ui", "world-state"],
    intensity: "action",
    lowTierCore: "Ability identity and cooldown state remain readable",
    state: "partial",
    note: "Every AbilityKind now drives an exhaustive class-weighted rig gesture; ability-specific effect-site reads and autoplay evidence still vary.",
  },
  "resonance-triggered": {
    action: "A different ability consumes the resonance window",
    stateChange: "The successful chain reads as distinct from an ordinary cast",
    lead: "world-vfx",
    channels: ["audio", "world-state"],
    intensity: "cast",
    lowTierCore: "A distinct resonance glyph/shape and sound remain",
    state: "partial",
    note: "Only a generic heavy card audio accent is routed today.",
  },
  "emission-leech": {
    action: "A Drain-axis Emission hit heals its caster",
    stateChange: "Energy visibly travels from victim to caster",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "world-state"],
    intensity: "hit",
    lowTierCore: "Victim-to-caster thread direction remains visible",
    state: "complete",
  },
  "sudden-death-started": {
    action: "A tied match enters sudden death",
    stateChange: "The arena and players clearly enter the decider",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "camera", "ui", "world-state"],
    intensity: "round",
    lowTierCore: "Storm boundary and sudden-death label remain readable",
    state: "complete",
  },
  "card-offered": {
    action: "The server offers a player draft choices",
    stateChange: "The combat rest beat becomes an actionable three-choice draft",
    lead: "ui",
    channels: ["ui", "world-state"],
    intensity: "round",
    lowTierCore: "All card names, effects, and input affordances remain readable",
    state: "partial",
    note: "Overlay exists; offer-arrival stack is not yet evidenced as complete.",
  },
  "draft-resolved": {
    action: "A player commits or auto-resolves a card",
    stateChange: "The selected card becomes owned and the draft closes",
    lead: "ui",
    channels: ["ui", "audio", "world-vfx", "camera", "world-state"],
    intensity: "round",
    lowTierCore: "Chosen card and applied-build confirmation remain readable",
    state: "complete",
  },
  "chain-hit": {
    action: "Lightning chains from one victim to another",
    stateChange: "The causal path between both targets is visible",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "camera", "world-state"],
    intensity: "hit",
    lowTierCore: "One clear bolt connects source and chain target",
    state: "complete",
  },
  "ready-toggled": {
    action: "A lobby player toggles readiness",
    stateChange: "The player's ready state changes at the totem and roster",
    lead: "world-state",
    channels: ["world-state", "audio", "ui"],
    intensity: "micro",
    lowTierCore: "Ready/not-ready shape or label remains visible",
    state: "complete",
  },
  "launch-requested": {
    action: "A lobby host requests launch",
    stateChange: "The product transitions from lobby to match when gating passes",
    lead: "world-state",
    channels: ["world-state", "ui"],
    intensity: "round",
    lowTierCore: "Transition/loading state remains explicit",
    state: "structural",
    note: "The successful scene transition is the feedback; failed gating is owned by lobby UI.",
  },
  "launch-pad-fired": {
    action: "A player crosses an active launch pad",
    stateChange: "The pad visibly throws the body",
    lead: "animation",
    channels: ["animation", "audio", "world-vfx", "camera", "world-state"],
    intensity: "action",
    lowTierCore: "Body impulse and launch-origin flash remain visible",
    state: "complete",
  },
  "slash-started": {
    action: "Interstice commits a blade swing",
    stateChange: "Opponents can read windup, active arc, and whiff",
    lead: "animation",
    channels: ["animation", "world-vfx"],
    intensity: "action",
    lowTierCore: "Blade windup and active arc silhouette remain visible",
    state: "partial",
    note: "Ground-loaded anticipation, live two-hand/body kinematics, held weapons, and world-space tip trails are integrated; canonical swing audio remains open.",
  },
  "slash-hit": {
    action: "Interstice's blade arc hits a victim",
    stateChange: "The hit reads specifically as blade contact, not only generic damage",
    lead: "world-vfx",
    channels: ["world-vfx", "camera", "world-state"],
    intensity: "heavy",
    lowTierCore: "Blade-contact line and victim reaction remain visible",
    state: "partial",
    note: "Generic hit-confirmed handles damage; blade-specific scrape/read is absent.",
  },
  "bash-landed": {
    action: "Kindled's chain finisher — the shield BASH — checks a victim",
    stateChange: "Victim is launched (biggest knockback in the game) and briefly staggered",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "camera", "animation", "world-state"],
    intensity: "heavy",
    lowTierCore: "Slab impact and the victim's launch remain visible",
    state: "partial",
    note: "Sim (low damage, max knockback, stagger) + bass-voiced hit cue + heavy hold live; slab-led contact chord, gold circuit smear, ground dust, and the pair-scoped stop are the Kindled feel-loop's iterations (slash-feel-ledger).",
  },
  "wave-spawned": {
    action: "A committed slash releases its aftermath wave",
    stateChange: "The blade action visibly produces a traveling wave",
    lead: "world-vfx",
    channels: ["world-vfx", "audio", "world-state"],
    intensity: "action",
    lowTierCore: "Wave body and origin remain visible",
    state: "complete",
  },
  "dash-through": {
    action: "Interstice crosses an enemy body during dash",
    stateChange: "Both players can perceive the successful body-cross",
    lead: "animation",
    channels: ["audio", "world-state"],
    intensity: "hit",
    lowTierCore: "A contact tick at the crossing point remains visible",
    state: "partial",
    note: "Audio exists, but the contact-site read is not explicit.",
  },
  "ward-absorbed": {
    action: "Kindled catches damage on Kindled Ward",
    stateChange: "The board absorbs force and visibly feeds Kindling",
    lead: "world-vfx",
    channels: ["world-vfx", "camera", "world-state"],
    intensity: "heavy",
    lowTierCore: "Gold blocker-position flash and Kindling gain remain readable",
    state: "partial",
    note: "Absorb flash exists; raise/hold/drop animation and audible fingerprint remain open.",
  },
  "team-peel-absorbed": {
    action: "Kindled's ward catches damage for an ally",
    stateChange: "The warder-to-victim save relationship is legible",
    lead: "world-vfx",
    channels: ["world-vfx", "camera", "world-state"],
    intensity: "heavy",
    lowTierCore: "Warder-origin save flash and protected ally remain identifiable",
    state: "partial",
    note: "Spatial flash exists; ally connection and audible fingerprint remain open.",
  },
  "syz-ward-absorbed": {
    action: "A Syzygist ward absorbs damage",
    stateChange: "The protected player, caster source, and remaining/broken ward read clearly",
    lead: "world-vfx",
    channels: ["world-vfx", "camera", "world-state"],
    intensity: "heavy",
    lowTierCore: "Cool-white barrier hit/break tell remains visible",
    state: "complete",
    note: "Cool-white protected/caster pulses, break scaling, and local-involvement shake make absorption and depletion attributable.",
  },
} as const satisfies Record<SimEventKind, EventPresentationContract>;

export function getEventPresentationContract(
  kind: SimEventKind,
): EventPresentationContract {
  return EVENT_PRESENTATION_REGISTRY[kind];
}

export function listIncompleteEventPresentationContracts(): Array<{
  kind: SimEventKind;
  contract: EventPresentationContract;
}> {
  return (Object.keys(EVENT_PRESENTATION_REGISTRY) as SimEventKind[])
    .filter((kind) => {
      const state = (EVENT_PRESENTATION_REGISTRY[kind] as EventPresentationContract).state;
      return state === "partial" || state === "missing";
    })
    .map((kind) => ({ kind, contract: EVENT_PRESENTATION_REGISTRY[kind] }));
}
