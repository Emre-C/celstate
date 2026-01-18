# Agent 2: Backend, Convex & Vercel Infrastructure

## Mission

Set up the Vercel deployment infrastructure: convert Convex files to TypeScript, create the Python serverless API layer, and configure Vercel routing.

---

## ⚠️ CRITICAL: This Is a Template Validation Exercise

**The starter-template is our golden reference.** We are using celstate as a real-world test case to validate that our starter-template can take any idea to a deployed app in record time.

### Your Primary Goals:
1. **Follow the starter-template patterns exactly** - Copy its Convex setup, API structure, and Vercel config faithfully
2. **Identify gaps and issues** - If something in the starter-template is missing, unclear, or broken, document it
3. **Improve the template** - Your experience here will make the template better for future projects

### Document Issues You Find

Create a file called `TEMPLATE-ISSUES-BACKEND.md` in the celstate root and log any problems you encounter:

```markdown
# Starter Template Issues (Backend/Infrastructure)

## Missing from Template
- [ ] Issue: ...
  - What I expected: ...
  - What I had to do instead: ...

## Unclear Documentation
- [ ] Issue: ...

## Suggestions for Improvement
- [ ] ...
```

**Examples of what to log:**
- Missing Convex configurations or patterns
- Vercel.json settings that don't work as documented
- Python API structure issues
- Environment variable documentation gaps
- Auth setup steps that are unclear or missing
- Anything you had to figure out that should have been obvious

This feedback is valuable - it will be used to improve the starter-template.

---

## Why We're Doing This

1. **Vercel Deployment**: Cloudflare Pages → Vercel for unified frontend + serverless Python backend
2. **TypeScript Consistency**: Convex files are currently JS, should be TS for type safety
3. **API Layer**: Celstate's Python processing needs HTTP endpoints via Vercel Serverless Functions

---

## Your Scope (DO NOT TOUCH)

✅ **You Own:**
- `convex/` folder (convert to TypeScript)
- `api/` folder (create FastAPI serverless)
- `vercel.json` (create)
- `.env.example` (create)
- `docs/vercel-deployment.md` (create)

❌ **DO NOT TOUCH (Agent 1 owns these):**
- `src/` folder (frontend)
- `package.json` (Agent 1 is merging it)
- `vite.config.ts`
- `tailwind.config.js`, `postcss.config.js`
- `index.html`
- `public/` folder

---

## Source Reference

Copy patterns from: `/Users/emre/Documents/codebase/active-projects/starter-template/`

Current Convex: `/Users/emre/Documents/codebase/active-projects/celstate/convex/`

---

## Step-by-Step Tasks

### 1. Convert Convex Files to TypeScript

#### 1a. convex/auth.config.js → convex/auth.config.ts

Current file uses JS. Convert to TS with proper typing:

```typescript
// convex/auth.config.ts
const authConfig = {
  providers: [
    {
      domain: process.env.AUTH_GOOGLE_DOMAIN,
      applicationID: process.env.AUTH_GOOGLE_ID,
    },
  ],
};

export default authConfig;
```

Read the current `auth.config.js` and convert while preserving all logic.

#### 1b. convex/auth.js → convex/auth.ts

Convert to TypeScript. Reference starter-template's `convex/auth.ts` for patterns:

```typescript
// Example structure from starter-template
import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});
```

Preserve celstate's existing auth configuration while converting to TS.

#### 1c. convex/http.js → convex/http.ts

Convert HTTP routes to TypeScript:

```typescript
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

export default http;
```

### 2. Update convex/schema.ts

Ensure it's properly typed. Check current schema and add explicit types if missing.

### 3. Keep Existing TS Files

These are already TypeScript, just verify they work:
- `convex/assets.ts`
- `convex/jobs.ts`
- `convex/lib/` (all files)

### 4. Create api/ Folder Structure

```
api/
├── index.py          # FastAPI entry point
├── requirements.txt  # Python dependencies
└── routes/
    ├── __init__.py
    └── health.py     # Basic health check endpoint
```

### 5. Create api/index.py

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Celstate API",
    description="Serverless Python backend for Celstate",
    version="1.0.0",
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "celstate-api"}


@app.get("/api/health")
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "version": "1.0.0",
    }
```

### 6. Create api/requirements.txt

Based on celstate's `pyproject.toml`, include only what's needed for HTTP endpoints:

```
fastapi>=0.109.0
```

**Note**: Keep this minimal. Heavy processing (Pandas, NumPy, ML libs) should only be added when specific endpoints need them. Vercel has package size limits.

### 7. Create vercel.json

```json
{
  "framework": "vite",
  "functions": {
    "api/index.py": {
      "runtime": "python3.9",
      "maxDuration": 60
    }
  },
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/index.py"
    },
    {
      "source": "/landing/:path*",
      "destination": "/landing/:path*"
    },
    {
      "source": "/((?!api|landing).*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, PUT, DELETE, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization" }
      ]
    }
  ]
}
```

**Routing Logic:**
- `/api/*` → Python serverless function
- `/landing/*` → Static landing page files
- Everything else → React SPA (`index.html`)

### 8. Create .env.example

Document all required environment variables:

```bash
# ===========================================
# CELSTATE ENVIRONMENT VARIABLES
# ===========================================

# --- Convex ---
VITE_CONVEX_URL=https://your-deployment.convex.cloud

# --- Convex Dashboard Variables ---
# Set these in Convex Dashboard, NOT in .env
# SITE_URL=https://your-domain.vercel.app
# JWT_PRIVATE_KEY=<from generateKeys.mjs>
# JWKS=<from generateKeys.mjs>
# AUTH_GOOGLE_ID=<from Google Cloud Console>
# AUTH_GOOGLE_SECRET=<from Google Cloud Console>
# SERVICE_KEY=<random-secret-for-pipeline>

# --- Vercel (for CI/CD) ---
# VERCEL_TOKEN=<from Vercel Dashboard>
# VERCEL_ORG_ID=<from Vercel Dashboard>
# VERCEL_PROJECT_ID=<after project creation>

# --- AI Services (for Python pipeline) ---
# GROQ_API_KEY=<for Kimi-K2 interpreter>
# GOOGLE_AI_API_KEY=<for Gemini image gen>
```

### 9. Create docs/vercel-deployment.md

```markdown
# Vercel Deployment Guide

This replaces the previous Cloudflare Pages deployment.

## Prerequisites

1. Vercel account
2. Convex production deployment
3. Google OAuth credentials (update redirect URIs)

## Initial Setup

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Link Project

```bash
cd celstate
vercel link
```

### 3. Set Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `VITE_CONVEX_URL` | Your Convex prod URL | Production |

### 4. Update Google OAuth

In Google Cloud Console, update redirect URIs:

**Remove:**
- `https://<deployment>.convex.site/api/auth/callback/google`

**Add:**
- `https://your-project.vercel.app/api/auth/callback/google`
- `https://your-custom-domain.com/api/auth/callback/google`

### 5. Update Convex Environment

In Convex Dashboard, update `SITE_URL`:

```
SITE_URL=https://your-project.vercel.app
```

## Deployment

### Development

```bash
# Start all services locally
vercel dev
```

This starts:
- Vite dev server (frontend)
- Python API (serverless simulation)
- Proper routing between them

### Production

```bash
# Deploy Convex
npx convex deploy --prod

# Deploy to Vercel
vercel --prod
```

## Verification

1. Visit `https://your-project.vercel.app/` - React app loads
2. Visit `https://your-project.vercel.app/api` - Returns `{"status": "ok"}`
3. Visit `https://your-project.vercel.app/landing/` - Static landing page
4. Test Google OAuth sign-in flow

## Differences from Cloudflare Pages

| Aspect | Cloudflare Pages | Vercel |
|--------|-----------------|--------|
| Build output | `dist/` | `.vercel/output/` |
| Python backend | Not supported | Serverless Functions |
| Base path | `/app/` | `/` (root) |
| Landing page | `dist/landing/` | `public/landing/` |
```

### 10. Create convex/tsconfig.json (if not exists)

Ensure Convex has its own tsconfig:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ES2021"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  },
  "include": ["./**/*.ts"],
  "exclude": ["_generated"]
}
```

---

## Verification

After completing all steps:

```bash
# Verify Convex compiles
npx convex dev
# Should start without TypeScript errors

# Verify Python API structure
python -c "from api.index import app; print('API OK')"
# Should not error (may need to cd to project root)

# Verify vercel.json is valid JSON
cat vercel.json | python -m json.tool
```

---

## Files You Will Create/Modify

| File | Action |
|------|--------|
| `convex/auth.config.ts` | CREATE (replace .js) |
| `convex/auth.ts` | CREATE (replace .js) |
| `convex/http.ts` | CREATE (replace .js) |
| `convex/auth.config.js` | DELETE (after .ts created) |
| `convex/auth.js` | DELETE (after .ts created) |
| `convex/http.js` | DELETE (after .ts created) |
| `api/index.py` | CREATE |
| `api/requirements.txt` | CREATE |
| `vercel.json` | CREATE |
| `.env.example` | CREATE |
| `docs/vercel-deployment.md` | CREATE |

---

## Important Notes

1. **Do NOT modify `src/celstate/`** - This is the CLI/local Python code, not the serverless API
2. **Preserve all Convex logic** - Just convert JS→TS, don't change behavior
3. **Keep API minimal** - Start with health check, add endpoints as needed later
4. **Test Convex independently** - Run `npx convex dev` before coordinating with Agent 1
