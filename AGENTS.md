# AI Agent Instructions

> **CRITICAL**: This codebase is 100% AI-built. You are the sole maintainer.

## Commands

```bash
# Python
uv run pytest              # Run tests
uv run ruff check src/     # Lint
uv run black src/          # Format
uv run mypy src/           # Type check

# Web
npm --prefix web run build # Build frontend
npm --prefix web run dev   # Dev server

# Convex (MUST use --history to avoid infinite streaming)
npx convex logs --prod --history 20   # Production logs
npx convex logs --history 20          # Dev logs
```

## Key Documents

| Document | Purpose |
|----------|---------|
| `update_plan.md` | Master plan + current status. **READ FIRST** |
| `Deployment.md` | Production deployment checklist |
| `docs/auth-setup.md` | Convex Auth + Google OAuth details |

## Architecture

**Image Pipeline:** `Prompt → Kimi-K2 → White Pass → Edit to Black → Diff Matte → PNG`

**Video Pipeline:** ⚠️ Blocked. Dual-pass Veo fails (motion diverges). See `update_plan.md` for alternatives.

## Models

| Component | Model |
|-----------|-------|
| Interpreter | `moonshotai/Kimi-K2-Instruct-0905:groq` via HF Router |
| Image Gen | `gemini-2.5-flash-image` (Nano Banana) |

## AI Principles

1. **Verify, don't guess** — "I think it works" is unacceptable
2. **Explicit > Implicit** — Verbose, self-documenting code
3. **Zero tech debt** — Fix issues immediately when noticed
4. **API docs first** — Use `web_search` before implementing any external API call
