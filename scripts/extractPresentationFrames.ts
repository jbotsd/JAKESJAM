import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  findCausalProjectilePair,
  type PresentationEvidenceManifest,
} from "./presentationEvidence.js";
import { presentationScenario } from "./presentationScenarios.js";

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error("usage: bun scripts/extractPresentationFrames.ts <manifest.json>");
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PresentationEvidenceManifest;
const scenario = presentationScenario(manifest.scenarioId);
if (!scenario) throw new Error(`unknown scenario ${manifest.scenarioId}`);
if (!scenario.framePlan) throw new Error(`scenario ${scenario.id} has no semantic frame plan`);
if (!manifest.videoPath || !existsSync(manifest.videoPath)) {
  throw new Error(`video missing for ${manifest.runId}: ${manifest.videoPath ?? "null"}`);
}

const outputDir = join(dirname(manifestPath), "frames", manifest.runId);
mkdirSync(outputDir, { recursive: true });
const impactPlan = scenario.framePlan.impact;
let impactAt = impactPlan
  ? manifest.observedBeats[impactPlan.beat]?.[0]
  : undefined;
let causalActionAt: number | undefined;

// Prefer an entity-id causal chain over temporal proximity. A long-range
// projectile can land after later shots have begun; "last shot before hit"
// would then extract a convincing-looking but false anticipation/action pair.
if (scenario.id === "core-starter-shot" && manifest.observedEvents) {
  const pair = findCausalProjectilePair(
    manifest.observedEvents,
    scenario.minimumProjectileFlightTicks,
  );
  if (pair) {
    causalActionAt = pair.actionAtMs;
    impactAt = pair.impactAtMs;
  }
}

for (const phase of ["anticipation", "action", "impact", "recovery"] as const) {
  const plan = scenario.framePlan[phase];
  if (!plan) continue;
  const candidates = manifest.observedBeats[plan.beat] ?? [];
  if (candidates.length === 0) throw new Error(`${manifest.runId}: beat ${plan.beat} absent`);
  // For anticipation/action, take the last causal action before the first
  // impact instead of an arbitrary first shot from a longer approach tape.
  const causal = (phase === "anticipation" || phase === "action") && causalActionAt !== undefined
    ? causalActionAt
    : impactAt === undefined
    ? candidates[0]!
    : candidates.filter((at) => at <= impactAt).at(-1) ?? candidates[0]!;
  const count = Math.max(1, plan.count ?? 1);
  const stepMs = plan.stepMs ?? 0;
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const atMs = Math.max(0, causal + plan.offsetMs + index * stepMs);
    const path = join(
      outputDir,
      `${phase}-${String(index).padStart(2, "0")}-${Math.round(atMs)}ms.png`,
    );
    const result = Bun.spawnSync([
      "ffmpeg", "-loglevel", "error", "-y",
      "-ss", (atMs / 1000).toFixed(3),
      "-i", manifest.videoPath,
      "-frames:v", "1",
      path,
    ]);
    if (result.exitCode !== 0 || !existsSync(path)) {
      throw new Error(
        `ffmpeg failed for ${phase}@${atMs}ms: ${result.stderr.toString()}`,
      );
    }
    paths.push(path);
  }
  manifest.frames[phase] = paths;
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `ok — ${basename(manifestPath)} semantic frames → ${outputDir}`,
);
