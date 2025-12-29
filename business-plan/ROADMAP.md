## 1) Manifest v0 — Strict JSON Schema (Draft 2020‑12)

> Goal: “boring, strict, lintable.”  
> v0 optimizes for reliability over expressive power. Frame-accurate cuts are optional; v0 can default to end-of-clip boundaries.

### 1.1 `generative-actor.manifest.v0.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.yourdomain.com/generative-actor/manifest-v0.schema.json",
  "title": "GenerativeActor Manifest v0",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "id", "intrinsics", "states", "initialState", "transitions", "assets", "accessibility"],
  "properties": {
    "version": { "type": "string", "const": "0.1" },
    "id": { "type": "string", "minLength": 1, "maxLength": 128 },
    "name": { "type": "string", "minLength": 1, "maxLength": 128 },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1, "maxLength": 64 },
      "maxItems": 32
    },

    "intrinsics": { "$ref": "#/$defs/Intrinsics" },

    "hitRegions": {
      "type": "array",
      "items": { "$ref": "#/$defs/HitRegion" },
      "maxItems": 8,
      "default": []
    },

    "assets": { "$ref": "#/$defs/Assets" },

    "states": {
      "type": "object",
      "minProperties": 1,
      "maxProperties": 24,
      "additionalProperties": { "$ref": "#/$defs/State" }
    },

    "initialState": { "type": "string", "minLength": 1 },

    "transitions": {
      "type": "array",
      "minItems": 0,
      "maxItems": 64,
      "items": { "$ref": "#/$defs/Transition" }
    },

    "preload": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": { "type": "string", "minLength": 1 },
        "maxItems": 12
      },
      "default": {}
    },

    "runtimeHints": { "$ref": "#/$defs/RuntimeHints" },

    "accessibility": { "$ref": "#/$defs/Accessibility" },

    "fallbacks": { "$ref": "#/$defs/Fallbacks" },

    "telemetry": { "$ref": "#/$defs/Telemetry" }
  },

  "allOf": [
    {
      "description": "Initial state must exist in states.",
      "properties": {
        "initialState": { "type": "string" },
        "states": { "type": "object" }
      }
    }
  ],

  "$defs": {
    "Vec2": {
      "type": "object",
      "additionalProperties": false,
      "required": ["x", "y"],
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" }
      }
    },

    "Size": {
      "type": "object",
      "additionalProperties": false,
      "required": ["width", "height"],
      "properties": {
        "width": { "type": "integer", "minimum": 1, "maximum": 4096 },
        "height": { "type": "integer", "minimum": 1, "maximum": 4096 }
      }
    },

    "Padding": {
      "type": "object",
      "additionalProperties": false,
      "required": ["top", "right", "bottom", "left"],
      "properties": {
        "top": { "type": "integer", "minimum": 0, "maximum": 512 },
        "right": { "type": "integer", "minimum": 0, "maximum": 512 },
        "bottom": { "type": "integer", "minimum": 0, "maximum": 512 },
        "left": { "type": "integer", "minimum": 0, "maximum": 512 }
      }
    },

    "Intrinsics": {
      "type": "object",
      "additionalProperties": false,
      "required": ["size", "anchor", "safePadding"],
      "properties": {
        "size": { "$ref": "#/$defs/Size" },
        "anchor": {
          "description": "Normalized anchor in [0..1]. Used for positioning/scaling.",
          "type": "object",
          "additionalProperties": false,
          "required": ["x", "y"],
          "properties": {
            "x": { "type": "number", "minimum": 0, "maximum": 1 },
            "y": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        "safePadding": { "$ref": "#/$defs/Padding" },
        "baseline": {
          "description": "Optional baseline hint for text-aligned components.",
          "type": "integer",
          "minimum": 0,
          "maximum": 4096
        }
      }
    },

    "HitRegion": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "type": "string", "enum": ["rect", "roundedRect", "circle", "polygon"] },

        "x": { "type": "number" },
        "y": { "type": "number" },
        "w": { "type": "number", "exclusiveMinimum": 0 },
        "h": { "type": "number", "exclusiveMinimum": 0 },
        "r": { "type": "number", "minimum": 0 },

        "cx": { "type": "number" },
        "cy": { "type": "number" },
        "radius": { "type": "number", "exclusiveMinimum": 0 },

        "points": {
          "type": "array",
          "items": { "$ref": "#/$defs/Vec2" },
          "minItems": 3,
          "maxItems": 32
        }
      },
      "allOf": [
        {
          "if": { "properties": { "type": { "const": "rect" } } },
          "then": { "required": ["x", "y", "w", "h"] }
        },
        {
          "if": { "properties": { "type": { "const": "roundedRect" } } },
          "then": { "required": ["x", "y", "w", "h", "r"] }
        },
        {
          "if": { "properties": { "type": { "const": "circle" } } },
          "then": { "required": ["cx", "cy", "radius"] }
        },
        {
          "if": { "properties": { "type": { "const": "polygon" } } },
          "then": { "required": ["points"] }
        }
      ]
    },

    "AssetRef": {
      "description": "Reference to an entry in assets.clips or assets.images.",
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },

    "ClipAsset": {
      "type": "object",
      "additionalProperties": false,
      "required": ["uri", "type"],
      "properties": {
        "uri": { "type": "string", "minLength": 1, "maxLength": 2048 },
        "type": { "type": "string", "enum": ["video/webp", "video/mp4", "video/webm", "image/gif"] },
        "hasAlpha": { "type": "boolean", "default": true },
        "fps": { "type": "integer", "minimum": 1, "maximum": 60 },
        "frameCount": { "type": "integer", "minimum": 1, "maximum": 2000 },
        "durationMs": { "type": "integer", "minimum": 1, "maximum": 600000 },
        "size": { "$ref": "#/$defs/Size" },
        "byteSize": { "type": "integer", "minimum": 0 }
      }
    },

    "ImageAsset": {
      "type": "object",
      "additionalProperties": false,
      "required": ["uri", "type"],
      "properties": {
        "uri": { "type": "string", "minLength": 1, "maxLength": 2048 },
        "type": { "type": "string", "enum": ["image/png", "image/webp", "image/jpeg"] },
        "hasAlpha": { "type": "boolean", "default": true },
        "size": { "$ref": "#/$defs/Size" },
        "byteSize": { "type": "integer", "minimum": 0 }
      }
    },

    "Assets": {
      "type": "object",
      "additionalProperties": false,
      "required": ["clips"],
      "properties": {
        "baseUri": {
          "description": "Optional base URI. If present, runtime resolves relative clip/image URIs against it.",
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        },
        "clips": {
          "type": "object",
          "minProperties": 1,
          "maxProperties": 128,
          "additionalProperties": { "$ref": "#/$defs/ClipAsset" }
        },
        "images": {
          "type": "object",
          "maxProperties": 128,
          "additionalProperties": { "$ref": "#/$defs/ImageAsset" },
          "default": {}
        }
      }
    },

    "Loop": {
      "type": "object",
      "additionalProperties": false,
      "required": ["mode"],
      "properties": {
        "mode": { "type": "string", "enum": ["none", "loop"] },
        "startFrame": { "type": "integer", "minimum": 0 },
        "endFrame": { "type": "integer", "minimum": 0 }
      }
    },

    "State": {
      "type": "object",
      "additionalProperties": false,
      "required": ["clip", "loop"],
      "properties": {
        "clip": { "$ref": "#/$defs/AssetRef" },
        "loop": { "$ref": "#/$defs/Loop" },

        "blendHint": {
          "description": "v0: only metadata. Runtime may ignore.",
          "type": "string",
          "enum": ["cut", "crossfade"],
          "default": "cut"
        },

        "reducedMotion": {
          "description": "Optional per-state reduced motion override.",
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "image": { "$ref": "#/$defs/AssetRef" }
          }
        }
      }
    },

    "EventType": {
      "type": "string",
      "enum": ["press", "release", "longPress", "focus", "blur", "enable", "disable", "timeout"]
    },

    "ExitAt": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": { "type": "string", "enum": ["end", "frame", "ms"] },
        "frame": { "type": "integer", "minimum": 0 },
        "ms": { "type": "integer", "minimum": 0 }
      },
      "allOf": [
        {
          "if": { "properties": { "type": { "const": "frame" } } },
          "then": { "required": ["frame"] }
        },
        {
          "if": { "properties": { "type": { "const": "ms" } } },
          "then": { "required": ["ms"] }
        }
      ]
    },

    "Transition": {
      "type": "object",
      "additionalProperties": false,
      "required": ["from", "to", "on"],
      "properties": {
        "from": { "type": "string", "minLength": 1 },
        "to": { "type": "string", "minLength": 1 },
        "on": { "$ref": "#/$defs/EventType" },

        "clip": {
          "description": "Optional one-shot clip. If absent, runtime cuts directly to 'to'.",
          "$ref": "#/$defs/AssetRef"
        },

        "play": { "type": "string", "enum": ["once"], "default": "once" },

        "exitAt": {
          "description": "When to leave current state. v0 defaults to end-of-clip.",
          "$ref": "#/$defs/ExitAt",
          "default": { "type": "end" }
        },

        "enterAt": {
          "description": "When to start the destination. v0 only supports start.",
          "type": "object",
          "additionalProperties": false,
          "required": ["type"],
          "properties": {
            "type": { "type": "string", "enum": ["start"] }
          },
          "default": { "type": "start" }
        },

        "cooldownMs": {
          "description": "Debounce repeated event triggers.",
          "type": "integer",
          "minimum": 0,
          "maximum": 60000,
          "default": 0
        },

        "priority": {
          "description": "Higher wins if multiple transitions match.",
          "type": "integer",
          "minimum": 0,
          "maximum": 100,
          "default": 0
        }
      }
    },

    "Accessibility": {
      "type": "object",
      "additionalProperties": false,
      "required": ["role", "label"],
      "properties": {
        "role": { "type": "string", "enum": ["button", "switch", "image", "progressbar", "status"] },
        "label": { "type": "string", "minLength": 1, "maxLength": 256 },
        "hint": { "type": "string", "maxLength": 256 },
        "reducedMotionPolicy": { "type": "string", "enum": ["preferStatic", "preferLowFps"], "default": "preferStatic" }
      }
    },

    "Fallbacks": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "staticImage": { "$ref": "#/$defs/AssetRef" },
        "lowEndVariantManifest": {
          "description": "Optional pointer to a smaller manifest.",
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        }
      }
    },

    "RuntimeHints": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "preferredClipTypes": {
          "type": "array",
          "items": { "type": "string", "enum": ["video/webp", "video/mp4", "video/webm"] },
          "maxItems": 3
        },
        "maxSimultaneousDecoders": { "type": "integer", "minimum": 1, "maximum": 4, "default": 2 },
        "memoryBudgetMb": { "type": "integer", "minimum": 4, "maximum": 256, "default": 64 }
      }
    },

    "Telemetry": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": { "type": "boolean", "default": true },
        "sampleRate": { "type": "number", "minimum": 0, "maximum": 1, "default": 0.1 },
        "sessionId": { "type": "string", "maxLength": 128 }
      }
    }
  }
}
```

**Notes / deliberate constraints in v0**
- `assets.clips` is the canonical lookup table; states/transitions reference keys.
- `Transition.clip` is optional (supports “hard cut”).
- `exitAt` supports `end/frame/ms`, but your runtime can implement only `end` initially while keeping forward compatibility.
- Hit regions are optional but schema-supported (important for irregular shapes).

---

## 2) Example Manifests (Known‑Good Archetypes)

These are “template topologies” that your generator should fill reliably.

### 2.1 ButtonActor v0 — “Nervous → Calm on Press”

```json
{
  "version": "0.1",
  "id": "button.nervous_calm.v1",
  "name": "Nervous Button (Calms on Press)",
  "tags": ["button", "nervous", "calm"],

  "intrinsics": {
    "size": { "width": 320, "height": 112 },
    "anchor": { "x": 0.5, "y": 0.5 },
    "safePadding": { "top": 12, "right": 16, "bottom": 12, "left": 16 }
  },

  "hitRegions": [
    { "type": "roundedRect", "x": 0, "y": 0, "w": 320, "h": 112, "r": 24 }
  ],

  "assets": {
    "baseUri": "https://cdn.yourdomain.com/actors/button.nervous_calm.v1/",
    "clips": {
      "idle_loop": {
        "uri": "idle_loop.webp",
        "type": "video/webp",
        "hasAlpha": true,
        "fps": 24,
        "frameCount": 48,
        "durationMs": 2000,
        "size": { "width": 320, "height": 112 }
      },
      "idle_to_pressed": {
        "uri": "idle_to_pressed.webp",
        "type": "video/webp",
        "hasAlpha": true,
        "fps": 24,
        "frameCount": 12,
        "durationMs": 500,
        "size": { "width": 320, "height": 112 }
      },
      "pressed_loop": {
        "uri": "pressed_loop.webp",
        "type": "video/webp",
        "hasAlpha": true,
        "fps": 24,
        "frameCount": 24,
        "durationMs": 1000,
        "size": { "width": 320, "height": 112 }
      },
      "pressed_to_idle": {
        "uri": "pressed_to_idle.webp",
        "type": "video/webp",
        "hasAlpha": true,
        "fps": 24,
        "frameCount": 10,
        "durationMs": 420,
        "size": { "width": 320, "height": 112 }
      }
    },
    "images": {
      "idle_static": { "uri": "idle_static.png", "type": "image/png", "hasAlpha": true, "size": { "width": 320, "height": 112 } }
    }
  },

  "states": {
    "idle": { "clip": "idle_loop", "loop": { "mode": "loop", "startFrame": 0, "endFrame": 47 } },
    "pressed": { "clip": "pressed_loop", "loop": { "mode": "loop", "startFrame": 0, "endFrame": 23 } }
  },

  "initialState": "idle",

  "transitions": [
    { "from": "idle", "to": "pressed", "on": "press", "clip": "idle_to_pressed", "exitAt": { "type": "end" }, "cooldownMs": 0, "priority": 10 },
    { "from": "pressed", "to": "idle", "on": "release", "clip": "pressed_to_idle", "exitAt": { "type": "end" }, "cooldownMs": 0, "priority": 10 }
  ],

  "preload": {
    "idle": ["idle_to_pressed", "pressed_loop"],
    "pressed": ["pressed_to_idle", "idle_loop"]
  },

  "runtimeHints": {
    "preferredClipTypes": ["video/webp", "video/mp4"],
    "maxSimultaneousDecoders": 2,
    "memoryBudgetMb": 48
  },

  "accessibility": {
    "role": "button",
    "label": "Continue",
    "hint": "Press to continue",
    "reducedMotionPolicy": "preferStatic"
  },

  "fallbacks": {
    "staticImage": "idle_static"
  },

  "telemetry": { "enabled": true, "sampleRate": 0.2 }
}
```

---

### 2.2 ToggleActor v0 — “Off ↔ On” (Switch Behavior)

```json
{
  "version": "0.1",
  "id": "toggle.crystal_onoff.v1",
  "name": "Crystal Toggle (On/Off)",
  "tags": ["toggle", "switch"],

  "intrinsics": {
    "size": { "width": 220, "height": 120 },
    "anchor": { "x": 0.5, "y": 0.5 },
    "safePadding": { "top": 10, "right": 10, "bottom": 10, "left": 10 }
  },

  "hitRegions": [
    { "type": "roundedRect", "x": 0, "y": 0, "w": 220, "h": 120, "r": 40 }
  ],

  "assets": {
    "baseUri": "https://cdn.yourdomain.com/actors/toggle.crystal_onoff.v1/",
    "clips": {
      "off_loop": { "uri": "off_loop.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 36, "durationMs": 1500, "size": { "width": 220, "height": 120 } },
      "off_to_on": { "uri": "off_to_on.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 12, "durationMs": 500, "size": { "width": 220, "height": 120 } },
      "on_loop": { "uri": "on_loop.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 36, "durationMs": 1500, "size": { "width": 220, "height": 120 } },
      "on_to_off": { "uri": "on_to_off.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 12, "durationMs": 500, "size": { "width": 220, "height": 120 } }
    },
    "images": {
      "off_static": { "uri": "off_static.png", "type": "image/png", "hasAlpha": true, "size": { "width": 220, "height": 120 } },
      "on_static": { "uri": "on_static.png", "type": "image/png", "hasAlpha": true, "size": { "width": 220, "height": 120 } }
    }
  },

  "states": {
    "off": { "clip": "off_loop", "loop": { "mode": "loop", "startFrame": 0, "endFrame": 35 } },
    "on": { "clip": "on_loop", "loop": { "mode": "loop", "startFrame": 0, "endFrame": 35 } }
  },

  "initialState": "off",

  "transitions": [
    { "from": "off", "to": "on", "on": "press", "clip": "off_to_on", "exitAt": { "type": "end" }, "priority": 10, "cooldownMs": 120 },
    { "from": "on", "to": "off", "on": "press", "clip": "on_to_off", "exitAt": { "type": "end" }, "priority": 10, "cooldownMs": 120 }
  ],

  "preload": {
    "off": ["off_to_on", "on_loop"],
    "on": ["on_to_off", "off_loop"]
  },

  "accessibility": {
    "role": "switch",
    "label": "Enable notifications",
    "hint": "Double tap to toggle",
    "reducedMotionPolicy": "preferStatic"
  },

  "fallbacks": { "staticImage": "off_static" },

  "telemetry": { "enabled": true, "sampleRate": 0.2 }
}
```

---

### 2.3 LoaderActor v0 — “Ambient Loop” + Optional “Success” One‑Shot

```json
{
  "version": "0.1",
  "id": "loader.forest_spirit.v1",
  "name": "Forest Spirit Loader",
  "tags": ["loader", "progress"],

  "intrinsics": {
    "size": { "width": 256, "height": 256 },
    "anchor": { "x": 0.5, "y": 0.5 },
    "safePadding": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
  },

  "assets": {
    "baseUri": "https://cdn.yourdomain.com/actors/loader.forest_spirit.v1/",
    "clips": {
      "loading_loop": { "uri": "loading_loop.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 48, "durationMs": 2000, "size": { "width": 256, "height": 256 } },
      "success_once": { "uri": "success_once.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 18, "durationMs": 750, "size": { "width": 256, "height": 256 } },
      "idle_loop": { "uri": "idle_loop.webp", "type": "video/webp", "hasAlpha": true, "fps": 24, "frameCount": 36, "durationMs": 1500, "size": { "width": 256, "height": 256 } }
    },
    "images": {
      "loading_static": { "uri": "loading_static.png", "type": "image/png", "hasAlpha": true, "size": { "width": 256, "height": 256 } }
    }
  },

  "states": {
    "loading": { "clip": "loading_loop", "loop": { "mode": "loop", "startFrame": 0, "endFrame": 47 } },
    "idle": { "clip": "idle_loop", "loop": { "mode": "loop", "startFrame": 0, "endFrame": 35 } }
  },

  "initialState": "loading",

  "transitions": [
    { "from": "loading", "to": "idle", "on": "timeout", "clip": "success_once", "exitAt": { "type": "end" }, "priority": 5 }
  ],

  "preload": {
    "loading": ["success_once", "idle_loop"]
  },

  "accessibility": {
    "role": "progressbar",
    "label": "Loading",
    "hint": "Content is loading",
    "reducedMotionPolicy": "preferLowFps"
  },

  "fallbacks": {
    "staticImage": "loading_static"
  },

  "telemetry": { "enabled": true, "sampleRate": 0.1 }
}
```

**Loader note:** `timeout` is a generic event that the host app/runtime can fire (e.g., when a request completes). In v0 you can also just expose an imperative API (`actor.play("success")`)—but keeping it event-based keeps the manifest declarative.

---

## 3) PRD — `@ai-media/client` + Cartridge API (MVP → v1)

### 3.1 Product Name
**GenerativeActor Platform**
- **Cartridge Factory API** (server): generate assets + manifest
- **Console Player** (`@ai-media/client`) (client): deterministic playback runtime for React Native

### 3.2 Objective
Enable an upstream AI agent (or developer) to request an interactive component in **one call** and use it in RN with **one line of code**, achieving:
- cinematic motion quality
- perfect compositing (alpha incl. soft shadows/glass/smoke)
- zero-latency state swaps (perceptually instant)
- accessibility + reduced motion compliance

### 3.3 In Scope (MVP / Phase 0–1)
**Client runtime (RN):**
- `<GenerativeActor />` component
- manifest validation (schema + runtime checks)
- asset resolution (baseUri + relative paths)
- caching (memory + disk)
- preloading (likely-next)
- deterministic state machine (events → transitions)
- platform fallback selection (supported clip types)
- reduced motion behavior (static image or low-fps loop)
- telemetry hooks

**Cartridge API:**
- generation templates (Button/Toggle/Loader)
- asset optimization pipeline (size/fps/duration/encode)
- manifest writer (conforms to schema)
- CDN packaging layout + versioning

### 3.4 Explicit Non‑Goals (MVP)
- arbitrary graph invention by LLM (template-only)
- frame-perfect cuts across all devices (v0 can cut on end-of-clip)
- multi-layer compositing / parallax stacks (Phase 3)
- runtime shaders / real-time lighting
- full authoring tool for humans

---

## 3.5 Functional Requirements

### A) Manifest + Validation
1. Runtime must reject invalid manifests with actionable errors:
   - missing assets
   - missing initialState
   - unknown transition targets
2. Provide a CLI linter:
   - `npx ai-media lint manifest.json`
3. Support manifest versioning:
   - `version: "0.1"` strict

### B) Playback + State Machine
1. On mount:
   - load `initialState` clip
   - begin playback
2. On event (`press`, `release`, etc.):
   - select matching transition (highest `priority`, then first)
   - enforce `cooldownMs`
   - if transition has `clip`, play it once, then enter `to` state
   - otherwise cut directly to `to` state
3. Loop behavior:
   - `loop.mode="loop"` loops seamlessly (runtime can simply loop clip; loop frame range is a hint in v0)
   - `loop.mode="none"` plays once and stops (rare in v0)

### C) Preload (Zero-Latency Illusion)
1. Runtime preloads:
   - everything in `preload[currentState]`
   - optionally always preloads `initialState` + its preload set before first render (configurable)
2. Preload must be capped by `runtimeHints.memoryBudgetMb` and `maxSimultaneousDecoders`.

### D) React Native Integration
1. Component API:
   ```ts
   type GenerativeActorProps = {
     source: ManifestObject | number /* require() */ | { uri: string };
     onEvent?: (evt: { type: string; from: string; to?: string }) => void;
     disabled?: boolean;
     style?: ViewStyle;
     testID?: string;
   }
   ```
2. Must behave like Pressable:
   - `disabled` prevents `press`/`release` transitions and fires `disable`/`enable` events
3. Accessibility:
   - sets RN accessibilityRole/Label/Hint from manifest
   - honors OS reduced motion setting

---

## 3.6 Performance Budgets (Hard Targets)

These budgets keep the “AAA illusion” intact.

### Asset Budgets (per actor)
- Default resolution: **≤ 512px** on largest dimension (MVP)
- FPS: **24** (allow 12 for reduced motion / low-end)
- Clip duration:
  - loops: **1–2s** recommended
  - transitions: **0.25–0.75s** recommended
- Typical actor (3–5 clips): **≤ 2 MB total** target (soft), **≤ 4 MB** max (hard) for “standard” tier

### Runtime Budgets
- Initial render time (TTFF): **< 250ms** on mid-tier devices once assets are local
- State swap latency: **no visible hitch**; measurable target:
  - **< 50ms** from event to swap if preloaded
- Dropped frames:
  - **< 1%** over 10s on test matrix
- Decoder concurrency:
  - default **2** max simultaneous decoders

---

## 3.7 Telemetry (What to Measure)
Minimum set (must be plumbed end-to-end):

- `manifest_load_ms`
- `asset_resolve_ms`
- `clip_preload_ms` (per clip)
- `ttff_ms` (time to first frame)
- `swap_latency_ms` (event → first frame of next clip)
- `dropped_frame_count` / `playback_stall_count`
- `memory_warning_count`
- `fallback_triggered` (type + reason)
- `device_info` (os, model, codec support summary)

Telemetry must be:
- gated by `telemetry.enabled`
- sampled by `telemetry.sampleRate`

---

## 3.8 Caching Strategy (MVP)
Two-level cache:
1. **Memory cache**: decoded or ready-to-play handles (bounded by memoryBudgetMb)
2. **Disk cache**: persisted clip files keyed by content hash / uri + version

Policies:
- LRU eviction
- pin currently playing clip + “likely next” set
- allow app to call `GenerativeActor.prefetch(manifest)` (optional but high leverage)

---

## 3.9 Format Negotiation (Pragmatic)
Runtime chooses best available clip type from:
- manifest’s `assets.clips[*].type`
- device support probe (platform-specific)
- `runtimeHints.preferredClipTypes`

Fallback rules:
1. Prefer alpha-capable video if supported
2. Else try alternate container/codec
3. Else fall back to `fallbacks.staticImage`

---

## 3.10 Device Test Matrix (Minimum)
You want this early because video+alpha is where dreams die.

**iOS**
- iPhone 12 (iOS 17/18)
- iPhone SE (2nd/3rd gen) for perf lower bound
- iPad (optional but useful)

**Android**
- Pixel 6/7 (baseline “good”)
- Samsung A-series mid-tier (critical)
- One “older” device (Android 10/11) if you claim broad support

Test conditions:
- low battery mode
- background/foreground transitions
- low memory pressure (simulate)
- reduced motion enabled
- dark mode/light mode backgrounds (alpha correctness check)

---

## 3.11 Acceptance Tests (Definition of Done)

### Phase 0 (ButtonActor)
1. **Schema compliance:** lint passes for generated manifest
2. **No manual fixes:** generated button works in RN sample app with one import line
3. **Swap quality:** press/release transitions have no black frames, no flicker
4. **Alpha correctness:** no halos on at least 3 background colors + 1 gradient background
5. **Reduced motion:** toggling OS reduced motion results in static image (or low-fps) with correct a11y
6. **Android sanity:** runs on mid-tier Samsung A-series without crashing; fallback triggers if codec unsupported

### Phase 1 (Toggle + Loader)
7. Toggle press toggles state deterministically (no double-trigger)
8. Loader loops indefinitely with <1% dropped frames; success transition plays when event fired

---

## 3.12 Milestones & Timeline (Aggressive, Realistic)

### Milestone M0 — Spec lock (2–3 days)
- Freeze manifest v0 schema
- Add linter CLI (schema validation + extra semantic checks)

### Milestone M1 — Runtime skeleton (3–5 days)
- `<GenerativeActor />` reads manifest and plays initial clip
- supports `press`/`release`
- simple transition playback (end-of-clip only)

### Milestone M2 — Preloading + caching (3–5 days)
- implement preload map
- memory cap + eviction
- TTFF + swap telemetry

### Milestone M3 — Android codec/fallback hardening (3–7 days)
- device capability probe
- fallback to static image
- test matrix runs + bug fixes

### Milestone M4 — Phase 0 exit demo (2–3 days)
- 3 generated buttons in a real RN screen
- recorded perf traces + telemetry summary

