import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  auditPresentationEvidence,
  type PresentationEvidenceManifest,
} from "./presentationEvidence.js";
import { PRESENTATION_SCENARIOS } from "./presentationScenarios.js";

const evidenceDir = process.argv[2] ?? "tests/e2e/.artifacts/presentation";
const manifests = new Map<string, PresentationEvidenceManifest[]>();

if (existsSync(evidenceDir)) {
  for (const name of readdirSync(evidenceDir).filter((entry) => entry.endsWith(".json"))) {
    const manifest = JSON.parse(readFileSync(join(evidenceDir, name), "utf8")) as PresentationEvidenceManifest;
    const list = manifests.get(manifest.scenarioId) ?? [];
    list.push(manifest);
    manifests.set(manifest.scenarioId, list);
  }
}

let failed = false;
for (const scenario of Object.values(PRESENTATION_SCENARIOS)) {
  const runs = manifests.get(scenario.id) ?? [];
  if (runs.length === 0) {
    console.error(`[evidence] ${scenario.id}: MISSING RUN (${scenario.driver})`);
    failed = true;
    continue;
  }
  for (const tier of scenario.qualityTiers) {
    const tierRuns = runs.filter((run) => run.qualityTier === tier);
    const passing = tierRuns.some((run) => auditPresentationEvidence(scenario, run).complete);
    if (!passing) {
      const latest = tierRuns.at(-1);
      const missing = latest
        ? auditPresentationEvidence(scenario, latest).missing.join(", ")
        : "no tier run";
      console.error(`[evidence] ${scenario.id}/${tier}: INCOMPLETE — ${missing}`);
      failed = true;
    } else {
      console.log(`[evidence] ${scenario.id}/${tier}: PASS`);
    }
  }
}

if (failed) process.exitCode = 1;
