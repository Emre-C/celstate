# Vertex AI + Convex (Celstate)

This app calls **Vertex AI** (not the Gemini Developer API key flow) from Convex **Node** actions using `@google/genai` with `vertexai: true`. Secrets live in **Doppler** (project `celstate`, config `prd`) and are synced into Convex on demand; Vercel only needs `PUBLIC_CONVEX_URL` and other public vars.

> **Routine rotation is automated.** To rotate the service-account key after
> a leak (or every 90 days), run:
>
> ```pwsh
> pnpm secrets:rotate-gcp -- `
>   --service-account=vertex-express@celstate-489304.iam.gserviceaccount.com `
>   --project=celstate-489304 `
>   --old-key-id=<CURRENT_KEY_ID>
> pnpm secrets:sync:convex
> ```
>
> The rotate script creates a new key via `gcloud`, validates the JSON,
> uploads it to Doppler as `VERTEX_AI_SERVICE_ACCOUNT_JSON`, and only then
> deletes the old key. See [`SECRETS-MANAGEMENT.md`](./SECRETS-MANAGEMENT.md).
> The manual setup steps below apply only to **first-time onboarding** of a
> new service account; routine operation does not touch the GCP console.

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

## First-time onboarding (new service account)

Use Doppler as the destination for the JSON key, then sync into Convex:

```pwsh
# 1. Create the key locally (gcloud writes JSON to a file).
gcloud iam service-accounts keys create .\vertex-key.json `
  --iam-account=vertex-express@celstate-489304.iam.gserviceaccount.com `
  --project=celstate-489304

# 2. Upload the JSON contents to Doppler `prd` as a single secret.
$json = Get-Content .\vertex-key.json -Raw
doppler secrets set VERTEX_AI_SERVICE_ACCOUNT_JSON="$json"
doppler secrets set VERTEX_AI_PROJECT_ID="celstate-489304"
doppler secrets set VERTEX_AI_LOCATION="global"

# 3. Shred the local key file (do not commit, do not leave on disk).
Remove-Item .\vertex-key.json -Force

# 4. Sync Doppler -> Convex prod.
pnpm secrets:sync:convex
```

For routine **rotation** (not initial setup), prefer the automated script
documented at the top of this file — it never writes the key JSON to disk.

## Repo hygiene

- Add service account JSON filenames to `.gitignore` (see root `.gitignore`).
- Never commit keys; rotate a key if it was committed or leaked.

## Vercel

No Vertex secrets on Vercel. Deploy the SvelteKit app with `PUBLIC_CONVEX_URL` pointing at your Convex deployment; image generation auth stays in Convex.

## Verify

1. `pnpm test -- src/convex/lib/gemini.test.ts`
2. Trigger a real generation in the app and check **Convex → Logs** for worker errors (auth, quota, IAM).
