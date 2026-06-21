// Minimal static server rooted at the repo root, so the web harness can import
// the REAL compiled runtime core from packages/living-ui-runtime/dist over http
// (ESM relative imports resolve naturally). No deps, deterministic MIME.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.PORT ?? process.argv[2] ?? 4178);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

const HARNESS_INDEX = "/bundles/web-harness/index.html";

createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  // Redirect the root to the harness's real path so the page URL keeps the
  // relative module imports (./harness.mjs, ../../packages/...) valid.
  if (urlPath === "/") {
    res.writeHead(302, { location: HARNESS_INDEX });
    res.end();
    return;
  }
  const filePath = normalize(join(repoRoot, urlPath));
  if (!filePath.startsWith(repoRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}).listen(port, () => {
  console.log(`web-harness serving ${repoRoot} on http://localhost:${port}`);
});
