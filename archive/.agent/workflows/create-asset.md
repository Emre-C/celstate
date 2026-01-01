---
description: Generate transparent UI assets (images and videos) using AI
---

# Create Mobile Asset

Generates transparent assets optimized for React Native/Expo smartphone apps.

**Images**: Auto-generates @1x, @2x, @3x density variants
**Videos**: 512px, 15fps animated WebP loops

## Prerequisites

```bash
export GEMINI_API_KEY="your-key"
pip install -r requirements.txt
brew install ffmpeg
```

---

## Image Asset

```bash
# One command to rule them all (auto-installs deps)
python .agent/tools/media_engine.py --type image --prompt "Glass potion bottle" --name potion
```

**Output**: `assets/generated/images/potion@{1x,2x,3x}.webp`

---

## Video Asset

```bash
# One command (auto-installs deps)
python .agent/tools/media_engine.py --type video --prompt "Floating sparkles" --name sparkles
```

**Output**: `assets/generated/videos/sparkles.webp`

---

## React Native Usage

```tsx
// Images - React Native auto-selects density
<Image source={require('./assets/generated/images/potion.webp')} />

// Animated assets
<Image source={require('./assets/generated/videos/sparkles.webp')} />
```
