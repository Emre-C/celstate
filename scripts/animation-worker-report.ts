import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

interface JsonRecord {
  [key: string]: unknown;
}

function parseArgs(argv: string[]): { workdir: string } {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
    } else if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else {
      flags.set(key, true);
    }
  }

  const workdir = flags.get("workdir");
  if (typeof workdir !== "string" || !workdir.trim()) {
    throw new Error("Pass --workdir <job-workdir>.");
  }

  return { workdir };
}

async function readJson(filePath: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

async function readEvents(workdir: string): Promise<JsonRecord[]> {
  try {
    const text = await readFile(path.join(workdir, "events.ndjson"), "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JsonRecord);
  } catch {
    return [];
  }
}

function formatMetric(value: unknown): string {
  return typeof value === "number" ? value.toFixed(4) : "n/a";
}

function printQa(label: string, qa: JsonRecord | null): void {
  if (!qa) {
    return;
  }

  const metrics = qa.metrics as JsonRecord | undefined;
  const reasonCodes = Array.isArray(qa.reasonCodes) ? qa.reasonCodes.join(", ") : "";
  console.log(`${label}: ${String(qa.decision ?? "unknown")}`);
  if (reasonCodes) {
    console.log(`  reasons: ${reasonCodes}`);
  }
  if (metrics) {
    console.log(
      `  alphaPresence=${formatMetric(metrics.alphaPresence)} borderTransparency=${formatMetric(metrics.borderTransparencyRatio)} externalSpill=${formatMetric(metrics.externalSpill)} haloTail=${formatMetric(metrics.haloTail)} fragmentNoise=${formatMetric(metrics.fragmentNoise)} topologyVolatility=${formatMetric(metrics.topologyVolatility)}`,
    );
  }
}

async function listArtifacts(workdir: string): Promise<void> {
  const entries = await readdir(workdir);
  const artifacts: string[] = [];
  for (const entry of entries.sort()) {
    const filePath = path.join(workdir, entry);
    const fileStat = await stat(filePath);
    if (fileStat.isFile() && /\.(apng|json|mov|ndjson|png|webm|zip)$/i.test(entry)) {
      artifacts.push(`${entry} (${Math.round(fileStat.size / 1024)} KB)`);
    }
  }

  if (artifacts.length === 0) {
    return;
  }

  console.log("artifacts:");
  for (const artifact of artifacts) {
    console.log(`  ${artifact}`);
  }
}

const { workdir } = parseArgs(process.argv.slice(2));
const job = await readJson(path.join(workdir, "job.json"));
const failure = await readJson(path.join(workdir, "failure.json"));
const events = await readEvents(workdir);

console.log(`workdir: ${workdir}`);
if (job) {
  console.log(`job: ${String(job._id ?? "unknown")}`);
  console.log(`prompt: ${String(job.prompt ?? "")}`);
  console.log(`useCase: ${String(job.useCase ?? "unknown")}`);
}
if (events.length > 0) {
  const lastEvent = events[events.length - 1];
  console.log(`last event: ${String(lastEvent.stage ?? "unknown")} ${String(lastEvent.status ?? "unknown")}`);
}
if (failure) {
  console.log(`failure: ${String(failure.message ?? "unknown")}`);
}

printQa("initial reference QA", await readJson(path.join(workdir, "initial-qa-reference.json")));
printQa("retry reference QA", await readJson(path.join(workdir, "retry-qa-reference.json")));
printQa("final reference QA", await readJson(path.join(workdir, "reference-qa.json")));
printQa("export QA", await readJson(path.join(workdir, "export-qa.json")));
await listArtifacts(workdir);
