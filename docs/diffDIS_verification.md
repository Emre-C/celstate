# DiffDIS Verification Report

## Purpose
Validate DiffDIS output quality and performance after integration. This report tracks the golden test output and cold/warm inference timings.

## Golden Test Asset
- **Asset name:** Hapnington hair test
- **Asset path:** _Add the local path here (do not commit the image)_

## How to Run
```bash
uv run scripts/diffdis_benchmark.py \
  --input /absolute/path/to/hapnington_hair_test.png \
  --report-file docs/diffDIS_verification.md
```

Optional flags:
- `--device mps|cuda|cpu`
- `--denoise-steps <int>`
- `--ensemble-size <int>`
- `--processing-res <int>`
- `--output-dir outputs/diffdis_verification`

### Outputs
The script writes artifacts to:
`outputs/diffdis_verification/<run-name>/`
- `mask.png`
- `edge.png`
- `rgba.png`

## Quality Checklist
- Hair/fur edges are clean, less haloing than dual-pass matte.
- Alpha transitions are smooth without over-cutting fine strands.
- Edge map highlights clear boundaries without noise.

## Benchmark Results
| Date | Device | Input | Resolution | Processing Res | Denoise Steps | Ensemble Size | Cold Start (s) | Warm Inference (s) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Notes / Issues
- _Add any integration or output issues here._
