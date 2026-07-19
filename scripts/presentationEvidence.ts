export const REVIEW_LENSES = [
  "state-change",
  "weight",
  "fighter-legibility",
  "class-lens",
  "audio-only",
  "low-tier",
] as const;

export type ReviewLens = (typeof REVIEW_LENSES)[number];
export type ReviewVerdict = "pass" | "fail" | "unreviewed";

export type PresentationScenario = {
  id: string;
  packageId: string;
  description: string;
  qualityTiers: readonly ("potato" | "phone" | "standard")[];
  requiredBeats: readonly string[];
  driver: "natural-match" | "loadout-scripted" | "forced-hook-required";
  characterId: "balanced" | "heavy" | "sprinter" | "shielded";
  requiredCardIds?: readonly string[];
  /** For projectile action sentences, refuse spawn-overlap hits that collapse
   * launch and impact into one presentation frame. Four ticks guarantees at
   * least one 20 Hz snapshot boundary lies between the two events. */
  minimumProjectileFlightTicks?: number;
  /** Event-relative semantic frame recipe. Impact can request a short burst
   * to reveal pose pops that a single still would conceal. */
  framePlan?: Partial<Record<
    "anticipation" | "action" | "impact" | "recovery",
    { beat: string; offsetMs: number; count?: number; stepMs?: number }
  >>;
};

export type PresentationEvidenceManifest = {
  schemaVersion: 1;
  scenarioId: string;
  packageId: string;
  runId: string;
  qualityTier: "potato" | "phone" | "standard";
  viewport: { width: number; height: number };
  startedAt: string;
  videoPath: string | null;
  audioPath: string | null;
  /** Raw authoritative events retained for causal pairing (for example the
   * exact shot whose projectile produced a hit), not just presence checks. */
  observedEvents?: PresentationEvidenceEvent[];
  observedBeats: Record<string, number[]>;
  frames: Partial<Record<"anticipation" | "action" | "impact" | "recovery", string[]>>;
  reviews: Record<ReviewLens, { verdict: ReviewVerdict; notes: string[] }>;
  defects: Array<{ id: string; description: string; resolved: boolean }>;
};

export type EvidenceAudit = { complete: boolean; missing: string[] };

export type PresentationEvidenceEvent = {
  kind: string;
  atMs: number;
  atTick?: number;
  abilityKind?: string;
  wardBroke?: boolean;
  localActor?: boolean;
  localTarget?: boolean;
  remoteOnly?: boolean;
  projectileIds?: number[];
  sourceProjectileId?: number | null;
};

export type CausalProjectilePair = {
  actionAtMs: number;
  impactAtMs: number;
  projectileId: number;
};

/** Match a local confirmed hit to the exact local trigger event that spawned
 * its projectile. Temporal closeness is deliberately insufficient: several
 * projectiles can be in flight at once. */
export function findCausalProjectilePair(
  events: readonly PresentationEvidenceEvent[],
  minimumFlightTicks = 0,
): CausalProjectilePair | undefined {
  for (const impact of events) {
    if (
      impact.kind !== "hit-confirmed" ||
      impact.remoteOnly === true ||
      impact.sourceProjectileId === null ||
      impact.sourceProjectileId === undefined
    ) continue;
    const action = events.find((event) =>
      event.kind === "shot-fired" &&
      event.localActor === true &&
      event.projectileIds?.includes(impact.sourceProjectileId!)
    );
    const flightTicks = action?.atTick !== undefined && impact.atTick !== undefined
      ? impact.atTick - action.atTick
      : undefined;
    if (
      action &&
      (minimumFlightTicks <= 0 ||
        (flightTicks !== undefined && flightTicks >= minimumFlightTicks))
    ) {
      return {
        actionAtMs: action.atMs,
        impactAtMs: impact.atMs,
        projectileId: impact.sourceProjectileId,
      };
    }
  }
  return undefined;
}

/** Convert authoritative events into the semantic beats scenarios are allowed
 * to require. Aliases live here—not scattered through the browser pilot—so a
 * scenario cannot accidentally pass from an input attempt or an unrelated
 * activation. */
export function collectObservedBeats(
  events: readonly PresentationEvidenceEvent[],
): Record<string, number[]> {
  const beats: Record<string, number[]> = {};
  const add = (beat: string, atMs: number) => {
    (beats[beat] ??= []).push(Math.round(atMs));
  };
  for (const event of events) {
    const prefix = event.remoteOnly ? "remote:" : "";
    add(`${prefix}${event.kind}`, event.atMs);
    if (event.remoteOnly) continue;
    if (event.kind === "ability-activated" && event.abilityKind) {
      add(`ability:${event.abilityKind}`, event.atMs);
      if (event.abilityKind === "self-lattice") add("ward-cast", event.atMs);
      if (event.abilityKind === "flock-pulse") add("flock-pulse", event.atMs);
    }
    if (event.kind === "syz-ward-absorbed" && event.wardBroke) {
      add("ward-broke", event.atMs);
    }
    if (event.kind === "parry-deflected" || event.kind === "dash-through") {
      add("parry-or-dash-through", event.atMs);
    }
  }
  return beats;
}

export function hasAllRequiredBeats(
  scenario: PresentationScenario,
  beats: Readonly<Record<string, readonly number[] | undefined>>,
): boolean {
  return scenario.requiredBeats.every((beat) => (beats[beat]?.length ?? 0) > 0);
}

/** Honest gate: artifact existence is checked by the filesystem runner; this
 * pure audit checks semantic coverage and refuses empty/pass-by-default data. */
export function auditPresentationEvidence(
  scenario: PresentationScenario,
  manifest: PresentationEvidenceManifest,
): EvidenceAudit {
  const missing: string[] = [];
  if (manifest.scenarioId !== scenario.id) missing.push("scenario-id");
  if (manifest.packageId !== scenario.packageId) missing.push("package-id");
  if (!scenario.qualityTiers.includes(manifest.qualityTier)) missing.push("quality-tier");
  if (!manifest.videoPath) missing.push("video");
  if (!manifest.audioPath) missing.push("audio-only-track");
  for (const beat of scenario.requiredBeats) {
    if ((manifest.observedBeats[beat]?.length ?? 0) === 0) missing.push(`beat:${beat}`);
  }
  for (const phase of ["anticipation", "action", "impact", "recovery"] as const) {
    if ((manifest.frames[phase]?.length ?? 0) === 0) missing.push(`frames:${phase}`);
  }
  for (const lens of REVIEW_LENSES) {
    if (manifest.reviews[lens].verdict !== "pass") missing.push(`review:${lens}`);
  }
  for (const defect of manifest.defects) {
    if (!defect.resolved) missing.push(`defect:${defect.id}`);
  }
  return { complete: missing.length === 0, missing };
}

export function makeUnreviewedManifest(
  scenario: PresentationScenario,
  args: Pick<PresentationEvidenceManifest, "runId" | "qualityTier" | "viewport" | "startedAt">,
): PresentationEvidenceManifest {
  return {
    schemaVersion: 1,
    scenarioId: scenario.id,
    packageId: scenario.packageId,
    ...args,
    videoPath: null,
    audioPath: null,
    observedBeats: {},
    frames: {},
    reviews: Object.fromEntries(
      REVIEW_LENSES.map((lens) => [lens, { verdict: "unreviewed", notes: [] }]),
    ) as PresentationEvidenceManifest["reviews"],
    defects: [],
  };
}
