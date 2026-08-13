// run.mjs - Perception Computer baseline과 prototype 반증을 직렬 실행한다.
const probes = [
  "baselineProbe.mjs",
  "worldModelProbe.mjs",
  "capsuleBudgetProbe.mjs",
  "activePerceptionProbe.mjs",
  "temporalIdentityProbe.mjs",
  "capabilityFusionProbe.mjs",
  "instructionBoundaryProbe.mjs",
  "transitionProofProbe.mjs",
  "replayCapsuleProbe.mjs",
];

for (const probe of probes) await import(new URL(probe, import.meta.url));
console.log(`perception computer attempt green: ${probes.length} probes`);
