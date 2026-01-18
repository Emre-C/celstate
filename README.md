# Celstate

AI pipeline for generating transparent PNG assets using single-pass image generation and DiffDIS background removal.

## How It Works

```
User Prompt → Interpreter (Kimi-K2) → White Pass → DiffDIS → Transparent PNG
```

1. **Interpreter** expands prompt with transparency constraints
2. **White Pass** generates image on white background (Gemini 2.5 Flash)
3. **DiffDIS** removes the background to produce an RGBA PNG

## Quick Start

```bash
# Install
uv sync
cd web && npm install && cd ..

# Generate keys (one-time)
node generateKeys.mjs

# Start Convex backend
npx convex dev

# Start web app
cd web && npm run dev
```

Visit `http://localhost:5173/app/` for the web app.

## CLI

```bash
celstate generate "a glowing health potion bottle" -o output.png
celstate process white.png black.png -o output.png
celstate remove-bg input.png -o output.png
celstate jobs
```

## Environment Variables

**Pipeline:**
```
VERTEX_API_KEY=...
VERTEX_PROJECT_ID=...
VERTEX_LOCATION=...
HF_TOKEN=...
```

**Auth (Convex):**
```
SITE_URL=http://localhost:5173
JWT_PRIVATE_KEY=...   # from generateKeys.mjs
JWKS=...              # from generateKeys.mjs
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
SERVICE_KEY=...
VITE_CONVEX_URL=...
```

## Deployment

### Cloudflare Pages

Build command:
```bash
npm --prefix web install && npm --prefix web run build && node scripts/build_static.mjs
```

Output directory: `dist`

### Routing

| Path | Content |
|------|---------|
| `/` | Redirects to `/landing/` |
| `/landing/` | Static landing page |
| `/app/` | Vite web app |

### Production Auth

1. Set all env vars in Convex dashboard (production)
2. Update Google Cloud Console with production domain
3. OAuth callback: `https://<deployment>.convex.site/api/auth/callback/google`

## API

### POST /v1/assets

```json
{
  "prompt": "string",
  "style_context": "string",
  "asset_type": "container|icon|texture|effect|image|decoration",
  "layout_intent": "auto|row|column",
  "render_size_hint": 160,
  "name": "string"
}
```

Returns: `{ "job_id": "uuid", "status": "queued" }`

### GET /v1/assets/{job_id}

Returns job status: `queued`, `processing`, `succeeded`, or `failed`.

## Testing

```bash
uv run pytest
```

## Status

- ✅ Image pipeline (working)
- ✅ Convex Auth + Google OAuth
- ✅ Web app with user-scoped data

## Commands

uv run celstate remove-bg landing/original.png -o out.png

uv run celstate remove-bg landing/original.png -o out.png \
  --denoise-steps 10 \
  --ensemble-size 3 \
  --processing-res 1024 \
  --use-tta \
  --tta-scales "0.75,1,1.25" \
  --tta-horizontal-flip \
  --match-input-res
