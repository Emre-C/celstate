#!/usr/bin/env python
"""DiffDIS verification + benchmarking harness."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import sys
import time
from typing import Optional

import numpy as np
from PIL import Image
import torch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.celstate.vendor.DiffDIS import DiffDISWrapper, DEFAULT_MODEL_ID

REPORT_HEADER = (
    "| Date | Device | Input | Resolution | Processing Res | Denoise Steps | "
    "Ensemble Size | Cold Start (s) | Warm Inference (s) | Notes |\n"
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
)


@dataclass(frozen=True)
class BenchmarkResult:
    timestamp: str
    device: str
    input_name: str
    resolution: str
    processing_res: int
    denoise_steps: int
    ensemble_size: int
    cold_seconds: float
    warm_seconds: float

    def to_markdown_row(self) -> str:
        return (
            "| {timestamp} | {device} | {input_name} | {resolution} | "
            "{processing_res} | {denoise_steps} | {ensemble_size} | "
            "{cold_seconds:.2f} | {warm_seconds:.2f} |  |\n"
        ).format(**self.__dict__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run DiffDIS on a single image and capture cold/warm timings.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Path to the golden test image (e.g. Hapnington hair test).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs/diffdis_verification"),
        help="Root output directory (a run subfolder is created).",
    )
    parser.add_argument(
        "--run-name",
        type=str,
        default=None,
        help="Optional name for the output subfolder.",
    )
    parser.add_argument(
        "--model-id",
        type=str,
        default=DEFAULT_MODEL_ID,
        help="Hugging Face model ID to load.",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Override device (cpu, mps, cuda).",
    )
    parser.add_argument(
        "--denoise-steps",
        type=int,
        default=1,
        help="Number of diffusion denoise steps.",
    )
    parser.add_argument(
        "--ensemble-size",
        type=int,
        default=1,
        help="Ensembling count for DiffDIS.",
    )
    parser.add_argument(
        "--processing-res",
        type=int,
        default=1024,
        help="Square processing resolution passed to DiffDIS.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=0,
        help="Batch size override (0 keeps DiffDIS default).",
    )
    parser.add_argument(
        "--show-progress",
        action="store_true",
        help="Show DiffDIS progress bars.",
    )
    parser.add_argument(
        "--no-match-input-res",
        action="store_false",
        dest="match_input_res",
        help="Disable resizing outputs back to input resolution.",
    )
    parser.add_argument(
        "--report-file",
        type=Path,
        default=None,
        help="Optional markdown file to append a results row to.",
    )
    parser.set_defaults(match_input_res=True)
    return parser.parse_args()


def tensor_to_grayscale(tensor: torch.Tensor) -> Image.Image:
    tensor = tensor.detach().float().cpu().clamp(0.0, 1.0)
    array = (tensor.numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(array, mode="L")


def synchronize_device(device: torch.device) -> None:
    if device.type == "cuda" and torch.cuda.is_available():
        torch.cuda.synchronize()
        return
    if device.type == "mps" and hasattr(torch, "mps"):
        synchronize = getattr(torch.mps, "synchronize", None)
        if synchronize:
            synchronize()


def timed_predict(
    wrapper: DiffDISWrapper,
    image: Image.Image,
    args: argparse.Namespace,
) -> tuple[torch.Tensor, torch.Tensor, float]:
    synchronize_device(wrapper.device)
    start = time.perf_counter()
    mask, edge = wrapper.predict(
        image,
        denoise_steps=args.denoise_steps,
        ensemble_size=args.ensemble_size,
        processing_res=args.processing_res,
        match_input_res=args.match_input_res,
        batch_size=args.batch_size,
        show_progress_bar=args.show_progress,
    )
    synchronize_device(wrapper.device)
    elapsed = time.perf_counter() - start
    return mask, edge, elapsed


def save_outputs(
    image: Image.Image,
    mask: torch.Tensor,
    edge: torch.Tensor,
    output_dir: Path,
) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    mask_img = tensor_to_grayscale(mask)
    edge_img = tensor_to_grayscale(edge)

    rgba = image.convert("RGBA")
    rgba.putalpha(mask_img)

    mask_path = output_dir / "mask.png"
    edge_path = output_dir / "edge.png"
    rgba_path = output_dir / "rgba.png"

    mask_img.save(mask_path)
    edge_img.save(edge_path)
    rgba.save(rgba_path)

    return mask_path, edge_path, rgba_path


def build_output_dir(root: Path, run_name: Optional[str], input_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if run_name:
        name = run_name
    else:
        name = f"{input_path.stem}-{timestamp}"
    return (root / name).resolve()


def append_report(report_path: Path, result: BenchmarkResult) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    needs_header = not report_path.exists() or report_path.stat().st_size == 0
    with report_path.open("a", encoding="utf-8") as handle:
        if needs_header:
            handle.write(REPORT_HEADER)
        handle.write(result.to_markdown_row())


def run_benchmark(args: argparse.Namespace) -> BenchmarkResult:
    input_path = args.input.expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")

    output_dir = build_output_dir(args.output_dir, args.run_name, input_path)

    image = Image.open(input_path).convert("RGB")

    wrapper = DiffDISWrapper(model_id=args.model_id, device=args.device)

    mask, edge, cold_seconds = timed_predict(wrapper, image, args)

    mask_path, edge_path, rgba_path = save_outputs(image, mask, edge, output_dir)

    _, _, warm_seconds = timed_predict(wrapper, image, args)

    result = BenchmarkResult(
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        device=str(wrapper.device),
        input_name=input_path.name,
        resolution=f"{image.width}x{image.height}",
        processing_res=args.processing_res,
        denoise_steps=args.denoise_steps,
        ensemble_size=args.ensemble_size,
        cold_seconds=cold_seconds,
        warm_seconds=warm_seconds,
    )

    print("\nDiffDIS verification outputs:")
    print(f"- Mask: {mask_path}")
    print(f"- Edge: {edge_path}")
    print(f"- RGBA: {rgba_path}")

    print("\nBenchmark summary:")
    print(f"- Device: {result.device}")
    print(f"- Input resolution: {result.resolution}")
    print(f"- Processing resolution: {result.processing_res}")
    print(f"- Denoise steps: {result.denoise_steps}")
    print(f"- Ensemble size: {result.ensemble_size}")
    print(f"- Cold start (load + first inference): {result.cold_seconds:.2f}s")
    print(f"- Warm inference: {result.warm_seconds:.2f}s")

    print("\nMarkdown row (paste into docs/diffDIS_verification.md):")
    print(result.to_markdown_row().strip())

    if args.report_file:
        append_report(args.report_file, result)
        print(f"\nAppended results to: {args.report_file.resolve()}")

    return result


def main() -> None:
    torch.set_grad_enabled(False)
    args = parse_args()
    run_benchmark(args)


if __name__ == "__main__":
    main()
