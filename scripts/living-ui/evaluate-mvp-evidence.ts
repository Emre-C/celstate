import { readFile } from "node:fs/promises";
import {
  evaluateLivingUiMvp,
  type LivingUiMvpEvidence,
} from "../../packages/living-ui-runtime/src/index.js";

const inputPath = process.argv[2];

if (!inputPath || inputPath === "--help" || inputPath === "-h") {
  console.error("Usage: pnpm living-ui:evaluate-mvp -- <evidence.json>");
  process.exitCode = 2;
} else {
  const evidence = JSON.parse(await readFile(inputPath, "utf8")) as LivingUiMvpEvidence;
  const evaluation = evaluateLivingUiMvp(evidence);
  console.log(JSON.stringify(evaluation, null, 2));
  process.exitCode = evaluation.pass ? 0 : 1;
}
