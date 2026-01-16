"""
Celstate CLI: AI-powered transparent asset generation.

Designed for AI-agent consumption. Returns structured JSON to stdout.
All jobs are logged to the jobs/ directory for traceability.

Usage:
    celstate generate "a glowing health potion bottle" -o potion.png
    celstate process white.png black.png -o transparent.png
"""

import json
import shutil
import time
from pathlib import Path
from typing import Optional

import typer

from celstate.contract import (
    normalize_layout_intent,
    resolve_asset_type,
    validate_job_create_request,
)
from celstate.generator import MediaGenerator
from celstate.job_store import JobStore
from celstate.orchestrator import Orchestrator
from celstate.processor import MediaProcessor

app = typer.Typer(
    name="celstate",
    help="Generate transparent images using AI + difference matting.",
    no_args_is_help=True,
)

# Default jobs directory (relative to workspace root)
JOBS_DIR = Path(__file__).parent.parent.parent.parent / "jobs"


def output_json(data: dict) -> None:
    """Output structured JSON to stdout."""
    print(json.dumps(data, indent=2))


def error_response(code: str, message: str, **kwargs) -> dict:
    """Create structured error response."""
    return {
        "status": "error",
        "code": code,
        "message": message,
        **kwargs
    }


@app.command("generate")
def generate(
    prompt: str = typer.Argument(..., help="Description of the asset to generate."),
    output: Path = typer.Option(..., "-o", "--output", help="Output path for the transparent PNG."),
    style_context: Optional[str] = typer.Option(
        None,
        "--style-context",
        help="Optional style context to bias generation (passed to interpreter).",
    ),
    render_size_hint: Optional[int] = typer.Option(
        None,
        "--render-size-hint",
        help="Optional render size hint in pixels (width).",
    ),
    layout_intent: Optional[str] = typer.Option(
        None,
        "--layout-intent",
        help="Optional layout intent for downstream usage (auto/row/column/etc.).",
    ),
    name: Optional[str] = typer.Option(
        None,
        "--name",
        help="Optional stable asset name (defaults to asset_<job_id>).",
    ),
    asset_type: Optional[str] = typer.Option(
        None,
        "--asset-type",
        help="Optional asset type override (container/icon/texture/effect/image/decoration).",
    ),
    seed: Optional[int] = typer.Option(
        None,
        "--seed",
        help="Random seed for reproducibility (ignored).",
    ),
):
    """Generate a transparent PNG image from a text prompt.
    
    Asset type (container, icon, texture, effect) is inferred from prompt keywords.
    Returns structured JSON to stdout. Job artifacts saved to jobs/ directory.
    """
    from dotenv import load_dotenv
    load_dotenv()
    
    start_time = time.time()

    validation_error = validate_job_create_request(
        prompt=prompt,
        asset_type=asset_type,
        render_size_hint=render_size_hint,
    )
    if validation_error:
        output_json(error_response("VALIDATION_FAILED", validation_error))
        raise typer.Exit(1)

    resolved_asset_type = resolve_asset_type(asset_type, prompt)
    resolved_layout_intent = normalize_layout_intent(layout_intent)
    resolved_style_context = style_context or ""

    try:
        job_store = JobStore(JOBS_DIR)
        generator = MediaGenerator()
        processor = MediaProcessor()
        orchestrator = Orchestrator(job_store, generator, processor)

        job = job_store.create_job(
            asset_type=resolved_asset_type,
            prompt=prompt,
            style_context=resolved_style_context,
            layout_intent=resolved_layout_intent,
            name=name,
            render_size_hint=render_size_hint,
        )

        job_id = job["id"]
        orchestrator.run_job(job_id)

        result = job_store.get_job(job_id)
        if not result:
            output_json(error_response("JOB_NOT_FOUND", f"Job {job_id} not found."))
            raise typer.Exit(1)

        if result.get("status") != "succeeded":
            error_msg = result.get("error") or "Job failed"
            error_payload = {"code": "GENERATION_FAILED", "message": error_msg}
            if result.get("retry_after"):
                error_payload["retry_after_seconds"] = result["retry_after"]
            output_json(error_response(**error_payload))
            raise typer.Exit(1)

        output_dir = JOBS_DIR / job_id / "outputs"
        output_source = output_dir / f"{result['name']}.png"
        if not output_source.exists():
            output_json(error_response("OUTPUT_MISSING", f"Missing output at {output_source}."))
            raise typer.Exit(1)

        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output_source, output)

        from PIL import Image

        with Image.open(output) as img:
            width, height = img.size

        generation_time_ms = int((time.time() - start_time) * 1000)
        transparency = None
        if result.get("component"):
            transparency = result["component"].get("telemetry")

        output_json(
            {
                "status": "success",
                "job_id": job_id,
                "output_path": str(output.absolute()),
                "dimensions": [width, height],
                "transparency": transparency,
                "generation_time_ms": generation_time_ms,
            }
        )
    except ValueError as e:
        error_msg = str(e)
        result = error_response("AUTH_ERROR" if "VERTEX" in error_msg else "API_ERROR", error_msg)
        output_json(result)
        raise typer.Exit(1)
    except RuntimeError as e:
        error_msg = str(e)
        if "HF_TOKEN" in error_msg:
            result = error_response("AUTH_ERROR", error_msg)
        elif "hollow" in error_msg.lower() or "center" in error_msg.lower():
            result = error_response(
                "HOLLOW_CENTER_MISSING",
                error_msg,
                suggestion="Add 'with hollow center' to prompt",
            )
        else:
            result = error_response("API_ERROR", error_msg)
        output_json(result)
        raise typer.Exit(1)
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        if "429" in error_msg or "quota" in error_msg.lower() or "rate" in error_msg.lower():
            result = error_response("RATE_LIMITED", error_msg, retry_after_seconds=60)
        else:
            result = error_response("API_ERROR", f"{error_type}: {e}")
        output_json(result)
        raise typer.Exit(1)


@app.command("process")
def process(
    white_path: Path = typer.Argument(..., help="Path to the white-background image."),
    black_path: Path = typer.Argument(..., help="Path to the black-background image."),
    output: Path = typer.Option(..., "-o", "--output", help="Output path for the transparent PNG."),
):
    """Extract transparency from existing white/black pass image pair.
    
    Returns structured JSON to stdout.
    """
    start_time = time.time()
    
    if not white_path.exists():
        output_json(error_response("VALIDATION_FAILED", f"White pass not found: {white_path}"))
        raise typer.Exit(1)
    if not black_path.exists():
        output_json(error_response("VALIDATION_FAILED", f"Black pass not found: {black_path}"))
        raise typer.Exit(1)
    
    try:
        from celstate.processor import MediaProcessor
        import tempfile
        
        processor = MediaProcessor()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            processor.process_image(
                white_path=white_path,
                black_path=black_path,
                name="asset",
                output_dir=output_dir,
            )
            
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(output_dir / "asset.png", output)
        
        from PIL import Image
        with Image.open(output) as img:
            width, height = img.size
        
        generation_time_ms = int((time.time() - start_time) * 1000)
        
        output_json({
            "status": "success",
            "output_path": str(output.absolute()),
            "dimensions": [width, height],
            "generation_time_ms": generation_time_ms
        })
        
    except Exception as e:
        output_json(error_response("API_ERROR", str(e)))
        raise typer.Exit(1)


@app.command("jobs")
def list_jobs(
    limit: int = typer.Option(10, "-n", "--limit", help="Number of jobs to show."),
):
    """List recent jobs."""
    job_store = JobStore(JOBS_DIR)
    jobs = job_store.list_jobs()
    output_json({"jobs": jobs[:limit], "total": len(jobs)})


@app.command("version")
def version():
    """Show version information."""
    from celstate import __version__
    output_json({"version": __version__})


if __name__ == "__main__":
    app()
