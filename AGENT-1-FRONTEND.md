# Agent 1: Frontend & Structure Migration

## Mission

Migrate celstate's web frontend from `web/` subdirectory structure (Cloudflare Pages) to the starter-template's root `src/` structure (Vercel-ready).

---

## ⚠️ CRITICAL: This Is a Template Validation Exercise

**The starter-template is our golden reference.** We are using celstate as a real-world test case to validate that our starter-template can take any idea to a deployed app in record time.

### Your Primary Goals:
1. **Follow the starter-template patterns exactly** - Copy its structure, conventions, and configurations faithfully
2. **Identify gaps and issues** - If something in the starter-template is missing, unclear, or broken, document it
3. **Improve the template** - Your experience here will make the template better for future projects

### Document Issues You Find

Create a file called `TEMPLATE-ISSUES-FRONTEND.md` in the celstate root and log any problems you encounter:

```markdown
# Starter Template Issues (Frontend)

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
- Missing dependencies that should be in the template
- Config files that need additional options
- Patterns that don't work as expected
- Documentation gaps in the template's AGENTS.md
- Anything you had to figure out that should have been obvious

This feedback is valuable - it will be used to improve the starter-template.

---

## Why We're Doing This

1. **Unified Deployment**: The starter-template uses a monorepo structure where frontend lives at root `src/`, enabling single Vercel deployment
2. **Modern Tooling**: Add Tailwind CSS, Shadcn/UI, and React Router for better developer experience
3. **Template Reuse**: Validate that starter-template can bootstrap real projects quickly

---

## Your Scope (DO NOT TOUCH)

✅ **You Own:**
- `src/` folder (create and populate)
- `package.json` (root level - merge dependencies)
- `vite.config.ts` (root level)
- `tailwind.config.js`, `postcss.config.js`, `components.json` (create)
- `tsconfig*.json` files (root level)
- `index.html` (root level)
- `public/` folder
- `.prettierrc`, `.prettierignore`, `eslint.config.js`

❌ **DO NOT TOUCH (Agent 2 owns these):**
- `convex/` folder
- `api/` folder
- `vercel.json`
- `.env*` files
- `src/celstate/` (Python backend - stays as-is for now)

---

## Source Reference

Copy patterns from: `/Users/emre/Documents/codebase/active-projects/starter-template/`

Migrate from: `/Users/emre/Documents/codebase/active-projects/celstate/web/`

---

## Step-by-Step Tasks

### 1. Create Root Config Files

Copy these from starter-template to celstate root:
- `tailwind.config.js`
- `postcss.config.js`
- `components.json`
- `.prettierrc`
- `.prettierignore`

### 2. Create New vite.config.ts

Create at celstate root with this structure:

```typescript
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Key Change**: Remove the `base: "/app/"` path - Vercel serves from root.

### 3. Create Root index.html

Copy from `web/index.html` to root, ensure it references `/src/main.tsx`.

### 4. Merge package.json

Create a merged `package.json` at root that combines:
- Current celstate root `package.json` (Convex deps)
- `web/package.json` (React deps)
- starter-template `package.json` (Tailwind, Shadcn, Router deps)

**Required dependencies to add:**
```json
{
  "dependencies": {
    "react-router-dom": "^7.6.3",
    "tailwind-merge": "^3.3.1",
    "tailwindcss-animate": "^1.0.7",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.525.0",
    "@radix-ui/react-slot": "^1.2.3",
    "sonner": "^2.0.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react-swc": "^3.10.2",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.17",
    "prettier": "^3.6.2"
  }
}
```

**Scripts should be:**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "format": "prettier --write \"src/**/*.{ts,tsx,js,jsx,json,css,md}\"",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,js,jsx,json,css,md}\""
  }
}
```

### 5. Create src/ Directory Structure

```
src/
├── assets/           # Static assets
├── components/
│   ├── ui/          # Shadcn components (copy from starter-template)
│   ├── Dashboard.tsx
│   └── SignIn.tsx
├── lib/
│   └── utils.ts     # Copy from starter-template (cn() helper)
├── pages/           # Future page components
├── routes/          # React Router config
├── App.tsx
├── index.css
├── main.tsx
└── vite-env.d.ts
```

### 6. Migrate Components

#### 6a. Copy web/src/main.tsx → src/main.tsx

Update to include React Router:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import App from './App.tsx';
import './index.css';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ConvexAuthProvider client={convex}>
        <App />
      </ConvexAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

#### 6b. Copy web/src/App.tsx → src/App.tsx

Keep the existing auth logic, just update imports to use `@/` alias.

#### 6c. Migrate Dashboard.tsx and SignIn.tsx

- Copy to `src/components/`
- Convert CSS classes to Tailwind (see section below)
- Update imports to use `@/` alias

### 7. Convert CSS to Tailwind

#### Current: web/src/components/Dashboard.css + SignIn.css
#### Target: Inline Tailwind classes

**Pattern to follow:**
```css
/* Before (CSS) */
.loading-screen {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

/* After (Tailwind in JSX) */
<div className="flex justify-center items-center min-h-screen">
```

Analyze the existing CSS files and convert each class to equivalent Tailwind utilities.

### 8. Create index.css with Tailwind

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    /* ... copy CSS variables from starter-template/src/index.css */
  }
  
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* ... dark mode variables */
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

### 9. Copy Shadcn UI Components

Copy from starter-template:
- `src/components/ui/` → celstate `src/components/ui/`
- `src/lib/utils.ts` → celstate `src/lib/utils.ts`

### 10. Handle Landing Page

Move `landing/` static files to `public/landing/`:
```
public/
└── landing/
    ├── index.html
    ├── competitor-result.png
    ├── original.png
    ├── our-result.png
    ├── zoom-competitor.png
    └── zoom-ours.png
```

### 11. Update tsconfig Files

Copy from starter-template:
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`

Ensure paths alias is configured:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

---

## Verification

After completing all steps, run:

```bash
# Install dependencies
npm install

# Verify build
npm run build

# Verify dev server starts
npm run dev
# Should start on port 5173 without errors
```

---

## Files You Will Create/Modify

| File | Action |
|------|--------|
| `package.json` | MODIFY (merge deps) |
| `vite.config.ts` | CREATE |
| `index.html` | CREATE (copy from web/) |
| `tailwind.config.js` | CREATE |
| `postcss.config.js` | CREATE |
| `components.json` | CREATE |
| `tsconfig.json` | MODIFY |
| `tsconfig.app.json` | CREATE |
| `tsconfig.node.json` | CREATE |
| `.prettierrc` | CREATE |
| `.prettierignore` | CREATE |
| `eslint.config.js` | CREATE |
| `src/main.tsx` | CREATE |
| `src/App.tsx` | CREATE |
| `src/index.css` | CREATE |
| `src/vite-env.d.ts` | CREATE |
| `src/lib/utils.ts` | CREATE |
| `src/components/ui/*` | CREATE |
| `src/components/Dashboard.tsx` | CREATE |
| `src/components/SignIn.tsx` | CREATE |
| `public/landing/*` | CREATE |

---

## Do NOT Delete Yet

Keep `web/` folder intact until Agent 2 confirms their work is complete and full integration is tested. We'll clean up in a later step.
