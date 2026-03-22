# Vertex AI + Convex (Celstate)

This app calls **Vertex AI** (not the Gemini Developer API key flow) from Convex **Node** actions using `@google/genai` with `vertexai: true`. Secrets live **only in Convex**; Vercel only needs `PUBLIC_CONVEX_URL` and other public vars.

## Official references

| Topic | Documentation |
|--------|----------------|
| Convex environment variables (8KB value limit, CLI) | [Environment Variables](https://docs.convex.dev/production/environment-variables) |
| `@google/genai` (Vertex + `GoogleAuthOptions`) | [js-genai release docs](https://googleapis.github.io/js-genai/release_docs/) |
| Vertex AI access control / IAM | [Access control (Generative AI on Vertex AI)](https://cloud.google.com/vertex-ai/generative-ai/docs/access-control) |
| Vertex IAM roles reference | [Vertex AI roles and permissions](https://cloud.google.com/iam/docs/roles-permissions/aiplatform) |

## GCP prerequisites

1. **Vertex AI API** enabled on the project; **billing** enabled.
2. Service account granted **`roles/aiplatform.user`** (Vertex AI User) at project scope (or a custom role with the minimum permissions your model calls need). See the access-control doc above.
3. Download a **JSON key** only for non-GCP runtimes (e.g. Convex). Prefer workload identity when running on GCP.

## Convex environment contract

Implemented in `src/convex/lib/gemini.ts` (`readGeminiRuntimeConfigFromEnv`).

| Variable | Required | Notes |
|----------|----------|--------|
| `VERTEX_AI_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` | Yes* | *Can be omitted if `VERTEX_AI_SERVICE_ACCOUNT_JSON` includes `project_id`. |
| `VERTEX_AI_LOCATION` or `GOOGLE_CLOUD_LOCATION` | No | Defaults to `global` in code. |
| `VERTEX_AI_SERVICE_ACCOUNT_JSON` | One auth path | Full JSON string of the service account key. **Convex value max 8KB** — typical keys are ~2–3KB. |
| `VERTEX_AI_CLIENT_EMAIL` + `VERTEX_AI_PRIVATE_KEY` | Alternative | Split vars if you avoid storing full JSON. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alternative | Path to a key file; useful locally, not for Convex cloud unless you mount a path. |

Do **not** set `GEMINI_API_KEY` for this pipeline — generation uses Vertex only.

## CLI: set from the JSON file (recommended)

Convex supports piping the key file as the value (avoids shell escaping):

```bash
npx convex env set VERTEX_AI_SERVICE_ACCOUNT_JSON --from-file ./path-to-your-key.json
npx convex env set VERTEX_AI_PROJECT_ID "your-gcp-project-id"
npx convex env set VERTEX_AI_LOCATION "global"
```

Use `--prod` for production when appropriate:

```bash
npx convex env set VERTEX_AI_SERVICE_ACCOUNT_JSON --from-file ./path-to-your-key.json --prod
```

Bulk `.env` files: `npx convex env set --from-file .env.convex` (see Convex docs).

## Repo hygiene

- Add service account JSON filenames to `.gitignore` (see root `.gitignore`).
- Never commit keys; rotate a key if it was committed or leaked.

## Vercel

No Vertex secrets on Vercel. Deploy the SvelteKit app with `PUBLIC_CONVEX_URL` pointing at your Convex deployment; image generation auth stays in Convex.

## Verify

1. `pnpm test -- src/convex/lib/gemini.test.ts`
2. Trigger a real generation in the app and check **Convex → Logs** for worker errors (auth, quota, IAM).
