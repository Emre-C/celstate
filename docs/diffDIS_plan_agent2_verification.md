# DiffDIS Plan — Agent 2 (Verification & Benchmarking)

**Owner:** Agent 2 (Verification, benchmarks, metrics)  
**Goal:** Validate DiffDIS output quality and performance after integration is wired.  
**Scope:** Tests, metrics, docs, and lightweight harnesses.  
**Do NOT edit:** `docs/diffDIS_plan_agent1_integration.md` or core integration files.

---

## ✅ Completed Context (Phase 1–2)
- Dependencies and vendoring done; audit logged in `docs/diffDIS_audit.md`.
- Wrapper class available at `src/celstate/vendor/DiffDIS/__init__.py`.
- Model ID: `qianyu1217/diffdis`.

---

## Phase 4: Verification (Your Ownership)

### 1) Golden Test
- **Asset:** “Hapnington hair test” image.
- **Action:** Run a single DiffDIS inference once integration is wired.
- **Output:** Save RGBA + mask + edge for inspection.
- **Criteria:** Hair/fur edge clarity > existing dual-pass output.

### 2) Benchmarking
- Measure **cold start** (first load + first inference).
- Measure **warm inference** (subsequent call).
- Record:
  - Wall time
  - Device (cpu/mps/cuda)
  - Image resolution

### 3) Reporting
- Write results into a short markdown note (new or append):
  - `docs/diffDIS_verification.md`
  - Include dates, settings, device, and any issues.

---

## Suggested Harness (Only if needed)
If no test harness exists, create a small utility in `scripts/` or `examples/` (ask Agent 1 before editing shared files) that:
1. Loads a local test image
2. Calls `DiffDISWrapper.predict`
3. Writes `mask.png`, `edge.png`, `rgba.png`

---

## Guardrails
- Do not change `MediaProcessor`, `Orchestrator`, CLI, or API code.
- Do not edit vendored DiffDIS code unless a correctness bug is proven.
- Keep all new files isolated (e.g., `scripts/diffdis_benchmark.py`).

---

## Exit Criteria
- Golden test completed with saved artifacts.
- Benchmark table recorded with cold vs warm inference times.
- Results documented in `docs/diffDIS_verification.md`.
