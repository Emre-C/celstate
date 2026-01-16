import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distDir = path.join(repoRoot, "dist");
const appDir = path.join(distDir, "app");
const landingSourceDir = path.join(repoRoot, "landing");
const landingDestDir = path.join(distDir, "landing");
const rootIndexPath = path.join(distDir, "index.html");

async function assertDirectoryExists(directoryPath, label) {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      throw new Error(`${label} exists but is not a directory: ${directoryPath}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${label} not found: ${directoryPath}`);
    }
    throw error;
  }
}

async function createRootRedirect() {
  const content = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Celstate</title>
    <meta http-equiv="refresh" content="0; url=/landing/" />
    <link rel="canonical" href="/landing/" />
    <style>
      body {
        font-family: "DM Sans", system-ui, -apple-system, sans-serif;
        background: #0a0a0b;
        color: #f5f5f7;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
      }
      a {
        color: #00ff88;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <p>Redirecting to <a href="/landing/">celstate.com/landing</a>…</p>
  </body>
</html>
`;

  await writeFile(rootIndexPath, content, "utf8");
}

async function buildStatic() {
  await assertDirectoryExists(appDir, "Web app build output");
  await assertDirectoryExists(landingSourceDir, "Landing assets");

  await mkdir(distDir, { recursive: true });
  await rm(landingDestDir, { recursive: true, force: true });
  await cp(landingSourceDir, landingDestDir, { recursive: true });
  await createRootRedirect();

  console.log("Static bundle ready in", distDir);
}

buildStatic().catch((error) => {
  console.error("Static bundle build failed:", error);
  process.exitCode = 1;
});
