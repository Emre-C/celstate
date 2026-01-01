# Video Difference Matting Feasibility: Research & Experiment Design

**Date:** 2025-12-29
**Status:** � **PIVOTING** — Approach 1 Failed. Moving to Approach 2 (I2V + Matting).

---

## Research Findings: Veo 3.1 Capabilities

### Critical Discovery: Frame Interpolation

Veo 3.1 has a **First and Last Frame** feature that creates videos by interpolating between two provided images:

```python
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt=prompt,
    image=first_image,                    # Starting frame
    config=types.GenerateVideosConfig(
        last_frame=last_image,             # Ending frame
        aspect_ratio="16:9"
    ),
)
```

> [!WARNING]
> **Approach 1 FAILED**: Dual-pass generation (White/Black) with Veo 3.1 failed to produce consistent internal motion, even with seeds. We are abandoning this approach for state machines.

### Other Relevant Features

| Feature | Parameter | Capability |
|---------|-----------|------------|
| **Reference Images** | `reference_images` | Up to 3 images for subject consistency |
| **Seed** | `seed` | Partial determinism (improves consistency, doesn't guarantee) |
| **Negative Prompt** | `negative_prompt` | Avoid unwanted elements |
| **Aspect Ratio** | `aspect_ratio` | 16:9 or 9:16 only |
| **Duration** | `duration_seconds` | 4, 5, 6, or 8 seconds |

---

## Veo 3.1: Best Practices for Start & End Frame Interpolation

When using Veo 3.1 to generate video between a specific first and last image, the model performs video interpolation. It generates the frames required to transition logically from the starting state to the ending state based on your text prompt.

### 1. Supported Models
Not all Veo models support the `last_frame` parameter. You must use one of the following models:

**Standard (High Quality):**
- `veo-3.1-generate-preview`
- `veo-3.1-generate-001`

**Fast (Lower Latency/Cost):**
- `veo-3.1-fast-generate-preview`
- `veo-3.1-fast-generate-001`

> [!NOTE]
> Older models like `veo-2.0-generate-001` also support this, but Veo 3.1 is recommended for better physics and prompt adherence.

### 2. The "Bridge" Prompt Strategy
The text prompt is the most critical element. It acts as the narrative bridge between your two images.

**Describe the Transition:** Do not just describe the scene; describe the action that transforms Image A into Image B.

**Connect the States:**
*   **Input Example:**
    *   First Image: Woman on a swing.
    *   Last Image: Empty swing.
*   **Prompt:** "She slowly fades away, vanishing completely... The empty swing is left swaying."

**Guidance:** Ensure your prompt explicitly mentions the visual elements present in both images and explains how they change (e.g., "The sun sets," "The car drives away," "The flower blooms").

### 3. Image Consistency
For the smoothest video generation, your input images should align technically and aesthetically.

*   **Aspect Ratio:** Ensure both the `first_image` and `last_frame` have the same aspect ratio (e.g., 16:9) to prevent warping or letterboxing artifacts.
*   **Visual Style:** Unless the goal is a style transfer (e.g., "Sketch turns into photograph"), ensure both images share the same lighting, color palette, and artistic style.
*   **Source:** Ideally, generate both images using the same model (e.g., Imagen 3 or Nano Banana) to guarantee pixel-level consistency in texture and resolution.

### 4. Python Implementation
The structure for passing a last frame differs from the first frame. You must import types to access the configuration object.

```python
import time
from google import genai
from google.genai import types

client = genai.Client()

# Define your images (loaded as bytes or PIL objects previously)
# first_image = ...
# last_image = ...

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    # The text prompt describing the transition
    prompt="A ghostly woman... fades away... vanishing completely.",
    
    # The Starting Point (Direct parameter)
    image=first_image, 
     config=types.GenerateVideosConfig(
        last_frame=last_image,
        aspect_ratio="16:9" # Recommended to be explicit
    ),
)

# Poll for completion
while not operation.done:
    print("Waiting for video generation...")
    time.sleep(10)
    operation = client.operations.get(operation)

# Retrieve result
video = operation.response.generated_videos[0]
client.files.download(file=video.video)
```

### 5. Ideal Use Cases
Using both start and end frames is best for:

*   **Object Disappearance/Appearance:** As seen in ghost or magic effects.
*   **Time-lapses:** Day to night transitions, or seasons changing (e.g., a green tree to a snowy tree).
*   **Trajectory Control:** A car at the start of a road vs. the end of the road (forcing the model to "drive" the car there).
*   **Morphs:** Transforming one object into another (e.g., a coffee mug turning into a cat).

---

## Proposed Experiment Approaches

### Approach 1: "Looping First/Last Frame" — **FAILED**

**Status:** 🔴 Failed (Motion Mismatch)

**Experiment History:**

| Attempt | Technical Change | Result | Finding |
|---------|------------------|--------|---------|
| v1-v5 | Gemini API (Standard) | `400 INVALID_ARGUMENT` | `last_frame` not supported on standard tier. |
| v6 | Vertex AI (No Seed) | ❌ **FAILED** | Loops correctly, but internal motion differs between passes. |
| v11 | Comparison | 🔴 **FAILED** | Even with `seed`, complex internal motion (e.g. pulsing heart) differs between passes. Inconsistent. |

### Approach 1.5: "Seeded Looping" — **SUCCESS (WAITING FOR MOTION REVIEW)**

**Status:** 🟢 Verified technically. Waiting for visual motion review.

**Experiment History:**

| Attempt | Technical Change | Result | Finding |
|---------|------------------|--------|---------|
| v6 | Vertex AI (No Seed) | ❌ **FAILED** | Motion mismatch between passes. |
| v7-v8 | Seed parameter fix | ✅ **SUCCESS** | Corrected param to `seed`. |
| v9 | Execution | ✅ **SUCCESS** | Videos generated successfully with seed=12345. |

### Approach 1.6: "Realistic UI Asset Test" — **SUCCESS (TECH VERIFIED)**

**Status:** 🟢 Technically successful. Waiting for visual motion review.

**Experiment History:**
- Run v10: "3D stylized vibrant red heart pulsing gently".
- Result: Both videos generated with identical seed and prompt.
- Observation: Edge-alignment and motion-blur synchronization are the primary goals.
- **Outcome**: Motion paths were NOT identical even with seed. **FAILED**.

### Approach 1.7: "RunComfy Transparent Generation" — **SUCCESS**
**Status**: 🟢 Verified
**Hypothesis**: New model via RunComfy API supports native transparent background generation.
**Outcome**: Verified! The API provides a `.zip` containing transparent PNG frames. **Confirmed high-quality alpha channel**.

### Research Findings: Wan Alpha Limits
*   **Model Family**: Part of the "Wan 2.1" family (Alibaba Tongyi Lab).
*   **Native Duration**: Capable of ~5 seconds (81-100 frames at 16fps), significantly longer than our current 33-frame output.
*   **Looping**: Not native, but achieving "motion-aware seamless loops" is possible via ComfyUI workflows (Video Continuation) or standard cross-dissolve techniques given the high stability.
*   **Reproducibility**: High. Supports seeding for deterministic output. The "Short" output we are seeing (33 frames) is likely a specific deployment constraint we can tune or override.

### Workflow Analysis (RunComfy JSON)
I've analyzed the specific ComfyUI workflow used by the API and found the hardcoded limits:
*   **Frame Count**: Node `40` (`EmptyHunyuanLatentVideo`) is set to `length: 33`.
    *   *Action*: We can override this input ("40": {"inputs": {"length": 81}}) to generate longer videos.
*   **Seed Control**: Node `3` (`KSampler`) takes a `seed` argument.
    *   *Action*: We can pass a specific seed to ensure identical output for variations.
*   **Resolution**: Currently set to `1280x720` in Node `40`.

### Video Consistency & Duration Experiments — **FAILED**
**Status**: 🔴 Failed
**Hypothesis**: Passing `seed` + `overrides.length=81` would allow consistent, long-duration variations (Idle/Press/Release) of the same character.
**Outcome**:
*   **Identity Drift**: Even with fixed seed, 1 of the 3 buttons looked completely different. T2V is not consistent enough for UI state machines.
*   **Action Failure**: The model ignored mechanical prompts like "compress" or "spring back".
*   **Duration**: Successfully generated long videos, but the content quality/identity broke down.

**Lessons Learned**:
1.  **T2V != State Machine**: Text-to-Video is great for *one-off* assets (like the "Ghost" or "Glass Sphere") but cannot guarantee pixel-perfect identity across multiple states.
2.  **Need Anchors**: We cannot rely on `seed` for consistency. We must use **Image-to-Video (I2V)**. We need to generate a perfect "Idle" frame and strictly drive the "Press" and "Release" videos from that source image to lock identity.

### Next Steps: Pivot to Image-to-Video (I2V)
*   **Goal**: Lock visual identity using an input image.
*   **Strategy**:
    1.  Generate a "Master Idle Frame" (using T2I or extracting from a good T2V run).
    2.  Use **Wan I2V** (if available) or SVD/Runway/Luma via API to animate *that specific image* into "Press" and "Release" states.
    3.  Investigate RunComfy I2V endpoints.

### Test Cases
1.  **Glass/Refraction** (Verified): "Cinematic close-up. A crystal sphere rotating slowly. The background of this video is transparent. Realistic lighting, refraction, caustics."
    *   *Result*: ✅ **SUCCESS** (33/33 transparent frames).
2.  **Fine Detail (Hair)** (Verified): "Close up. A cute fluffy white monster looking left and right. Wispy fur blowing in gentle wind. The background of this video is transparent. Pixar style, soft lighting."
    *   *Result*: ✅ **SUCCESS** (33/33 transparent frames).
3.  **Fast Motion** (Verified): "A red rubber ball bouncing energetically. Motion blur. The background of this video is transparent. 60fps."
    *   *Result*: ✅ **SUCCESS** (33/33 transparent frames).
4.  **UI Component** (Verified): "A stylized 3D 'Play' button pulsating and glowing. Gentle idle animation. The background of this video is transparent. Premium UI design, soft shadows."
    *   *Result*: ✅ **SUCCESS** (33/33 transparent frames).

### New Script: `src/engine/test_robustness.py`
#### [NEW] [test_robustness.py](file:///Users/emre/Documents/codebase/active-projects/celstate/src/engine/test_robustness.py)
*   **Purpose**: Queue multiple requests in parallel and download results.
*   **Features**:
    *   Batch submission of 4 distinct prompts.
    *   Concurrent polling.
    *   Automatic download and extraction.
    *   Alpha verification summary.



**Observation:**
The correct parameter for `GenerateVideosConfig` in the Python SDK is `seed`, not `random_seed` (despite what some REST API docs say).

**Next Steps:**
Retry generation when quota resets to confirm motion consistency.


#### User Review Required
> [!NOTE]
> **Pivot to RunComfy**: We are switching to an external provider (RunComfy) which claims to support direct transparent video generation. This simplifies the pipeline significantly if it works.

#### Proposed Changes

### New Script: `src/engine/debug_runcomfy.py`
#### [NEW] [debug_runcomfy.py](file:///Users/emre/Documents/codebase/active-projects/celstate/src/engine/debug_runcomfy.py)
*   **Purpose**: Verify transparent video generation with RunComfy API.
*   **Implementation**:
    ```python
    import requests
    import os

    url = 'https://api.runcomfy.net/prod/v1/deployments/dfbd6f98-5a44-465f-a9f8-fdf9c3deddac/inference'
    headers = {
      'Authorization': f"Bearer {os.environ.get('RUNCOMFY_API_TOKEN')}",
      'Content-Type': 'application/json'
    }
    payload = { 'overrides': {
      "6": {
        "inputs": {
          "text": "Medium shot. Side Profile. A little girl holds a bubble wand and blows out colorful bubbles that float and pop in the air. The background of this video is transparent. Realistic style."
        }
      }
    } }
    # ... logic to poll and download ...
    ```

## Verification Plan

### Automated Tests
1.  **Run RunComfy Debug Script**:
    *   Command: `python src/engine/debug_runcomfy.py`
    *   Expected Output: `transparent_video.mp4` (or similar) downloaded successfully.
    *   Verification: Open video to confirm transparency and quality.

### Manual Verification
*   Check the API cost/latency.
*   Check if the transparency is true alpha channel or just a green screen that needs keying (prompt implies "background... is transparent").

---

### Exact Technical Implementation (for Research)

The following pattern was used to isolate the failure:

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="...")

# 1. Generate static Anchor Frame
# Success: Standard content generation works
resp = client.models.generate_content(
    model='gemini-2.5-flash-image',
    contents=['A robot standing on white background'],
)
anchor_image = resp.parts[0].as_image()

# 2. Attempt Video Interpolation
# Failure: Returns 400 even if anchor_image is valid
try:
    operation = client.models.generate_videos(
        model='veo-3.1-fast-generate-preview',
        prompt='A robot gently moving.',
        image=anchor_image,                   # Worked in isolation
        config=types.GenerateVideosConfig(
            last_frame=anchor_image,          # Triggered rejection
            aspect_ratio='16:9',
            duration_seconds=4,
        ),
    )
except Exception as e:
    # Error: {"error": {"code": 400, "message": "Your use case is currently not supported...", "status": "INVALID_ARGUMENT"}}
    print(f"ERROR: {e}")
```

### Technical Findings & Observations

1.  **Image Serialization**: The SDK provides `types.Image.from_file()`, but for generated content, accessing the image via `response.parts[0].as_image()` (which yields a `google.genai.types.Image` object) is the most direct path.
2.  **Model Availability**: Both `veo-3.1-fast-*` and `veo-3.1-standard-*` models are accessible for basic text-to-video and image-to-video, but both reject the `last_frame` parameter.
3.  **Documentation Discrepancy**: While docs suggest `last_frame` is supported for Veo 3.1, the backend enforcement on the `ai.google.dev` (Gemini API) endpoint seems to prevent it. This likely indicates an **Enterprise-only** feature.

---

### Critical Finding: `last_frame` Requires Vertex AI

**Isolated Tests Performed:**

| Test | Parameters | Result |
|------|------------|--------|
| Image-to-video (first frame only) | `image=` ✓ | ✅ **Works** |
| Image-to-video with interpolation | `image=` + `last_frame=` | ❌ **"Use case not supported"** |
| Different start/end images | `first≠last` | ❌ **Same error** |
| Same start/end images (loop) | `first=last` | ❌ **Same error** |

**Conclusion:** The `last_frame` parameter is **not supported** on the Gemini API consumer tier (`ai.google.dev`). This feature appears to require Vertex AI (`cloud.google.com/vertex-ai`).

> [!CAUTION]
> The official documentation shows `last_frame` examples, but they may only work on Vertex AI endpoints. The Gemini API (free tier) does **not** support video interpolation between frames.

---

### Options to Unblock

1. **Switch to Vertex AI** (Requires GCP account + billing)
   - Enables `last_frame`, `seed`, and other advanced features
   - Higher cost per generation

2. **Pivot to Approach 4** (Pragmatic Fallback)
   - Use chroma key for video alpha (lossy but works)
   - Use static Difference Matting for key frames only
   - Hybrid quality: motion is imperfect, state transitions are pixel-perfect

3. **Alternative: Video Extension/Continuation**
   - Test if extending a video maintains motion consistency
   - Generate on white → extend → generate on black with same extension

---

### Approach 2: "Subject Reference + Color Swap" (BACKUP)

**Hypothesis:** Using reference images to lock subject appearance, then generating on different backgrounds.

**Experiment Design:**
1. Generate a perfect-alpha static subject with Difference Matting (current workflow)
2. **Video Pass 1 (White):**
   - `reference_images = [subject_matted.png]`
   - Prompt: "This exact subject. Isolated on solid white #FFFFFF. Gentle idle animation."
3. **Video Pass 2 (Black):**
   - `reference_images = [subject_matted.png]` (SAME reference)
   - Prompt: "This exact subject. Isolated on solid black #000000. Gentle idle animation."

**Advantage:** Reference images might force subject identity consistency.
**Risk:** Motion paths will still differ.

---

### Approach 3: "Video Extension Chain" (EXPERIMENTAL)

**Hypothesis:** Use video extension to create longer clips with consistent motion, then compare.

**Experiment Design:**
1. Generate short video on white (4 seconds)
2. Extend that video with same parameters
3. Compare motion to a black-background version

**Note:** This is less likely to work because extension continues motion, doesn't replicate it.

---

### Approach 4: "Accept Lossy Video + Perfect Key Frames" (PRAGMATIC)

**If experiments 1-3 fail**, this is the fallback:

- **Video:** Use chroma key (current approach) — "good enough" alpha
- **Key Frames:** At state transitions, use static images with perfect Difference Matting alpha
- **Result:** Hybrid quality — movement is slightly imperfect, but critical moments (button press, state change) are pixel-perfect

---

---

## Approach 2: Identity-Locked I2V + Neural Matting (SELECTED)

**Goal:** Solve the "Identity Drift" problem of T2V while maintaining high-quality alpha.

**The Concept:**
1.  **Master Asset**: Generate ONE perfect static image (with alpha). This is our "ground truth" for the UI component.
2.  **Identity Lock**: Use **Image-to-Video (I2V)** to animate this exact images. This guarantees that the "Press" and "Release" states look exactly like the "Idle" state.
3.  **Alpha Recovery**: Since standard I2V models (Luma/Runway/Veo) often return solid backgrounds, use **Robust Video Matting (RVM)** to strip the background and restore transparency.

### Step 1: Robust Video Matting (RVM) Prototype
We need to verify we can run RVM locally (or via a simple script) to accept a video on black/white and output an alpha matte.
*   **Source:** [PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting)
*   **Method:** Use `torch.hub` to load the model without complex compilation.

### Step 2: I2V Generation
*   Use RunComfy or Veo I2V to generate the motion.
*   Input: The master static image.
*   Prompt: "Button being pressed down", "Button springing back up".

## Implementation Steps

### 1. Prototype RVM
Create `src/engine/test_rvm.py` to:
1.  Load RVM MobileNetV3 (lightweight).
2.  Process a sample video (e.g., from our failed experiments).
3.  Output a transparent `.webm` or `.mov`.

### 2. Verify Quality
Check if RVM can handle the "soft edges" of our UI assets (glows, shadows) better than FFmpeg chroma key.

## Verification Plan

### Automated Tests
1.  **RVM Test**:
    *   Command: `python src/engine/test_rvm.py`
    *   Input: `assets/test_input.mp4` (solid background)
    *   Output: `assets/test_output_rvm.webm`
    *   Success: Output has alpha channel and no green halo.

### Manual Review
*   Compare RVM matte quality vs. FFmpeg matte.

