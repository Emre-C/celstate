"""
Hapnington Media Engine: Orchestrator
=====================================
Auto-bootstrapping script to generate and process assets in one go.
Dependency-free entry point (uses only Python Standard Library).

Usage:
    python .agent/tools/media_engine.py --prompt "Glass bottle" --type image --name potion
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Constants
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TOOLS_DIR = PROJECT_ROOT / ".agent" / "tools"
VENV_DIR = PROJECT_ROOT / ".venv"

if sys.platform == "win32":
    PYTHON_EXEC = VENV_DIR / "Scripts" / "python.exe"
    PIP_EXEC = VENV_DIR / "Scripts" / "pip.exe"
else:
    PYTHON_EXEC = VENV_DIR / "bin" / "python"
    PIP_EXEC = VENV_DIR / "bin" / "pip"


def load_env():
    """Load .env file into os.environ (simple parser)."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return

    print(f"📄 Loading environment from {env_path.name}...")
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                # Remove quotes if present
                value = value.strip('\'"')
                os.environ[key.strip()] = value


def ensure_venv():
    """Ensure a virtual environment exists and has requirements installed."""
    if not VENV_DIR.exists():
        print("📦 First run detected. Setting up virtual environment...")
        try:
            subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])
        except subprocess.CalledProcessError:
            print("❌ Failed to create virtual environment.")
            sys.exit(1)
            
        print("📥 Installing dependencies (this may take a minute)...")
        req_file = PROJECT_ROOT / "requirements.txt"
        if req_file.exists():
            subprocess.check_call([str(PIP_EXEC), "install", "-q", "-r", str(req_file)], stderr=subprocess.DEVNULL)
        print("✅ Environment ready.\n")
    else:
        # Quick sanity check - if requirements changed, we might want to update, 
        # but for speed we'll assume it's good if venv exists.
        pass


def run_command_in_venv(script_name, args):
    """Run a script from the tools dir inside the venv."""
    script_path = TOOLS_DIR / script_name
    cmd = [str(PYTHON_EXEC), str(script_path)] + args
    
    # We want to capture stdout to parse JSON, but also stream it so user sees progress.
    # The tools print progress to stdout/stderr. To reliably capture the JSON result
    # we added a marker in media_generator, and media_processor prints clean JSON at end?
    # Actually, media_generator now prints __JSON_START__...__JSON_END__.
    # media_processor just prints JSON at the end.
    
    process = subprocess.Popen(
        cmd, 
        stdout=subprocess.PIPE, 
        stderr=subprocess.STDOUT, # Merge stderr to see errors inline
        encoding='utf-8',
        bufsize=1, 
        universal_newlines=True
    )
    
    output_lines = []
    json_block = []
    in_json = False
    
    # Stream output
    while True:
        line = process.stdout.readline()
        if not line and process.poll() is not None:
            break
        if line:
            # Check for our markers
            if "__JSON_START__" in line:
                in_json = True
                continue
            if "__JSON_END__" in line:
                in_json = False
                continue
                
            if in_json:
                json_block.append(line)
            else:
                # If not in flagged json block, print to console
                sys.stdout.write(line)
                sys.stdout.flush()
            
            output_lines.append(line)
            
    rc = process.poll()
    if rc != 0:
        raise RuntimeError(f"{script_name} failed with exit code {rc}")

    # Parse what we captured
    # For media_generator, we used markers.
    if json_block:
        return json.loads("".join(json_block))
        
    # For media_processor (or fallback), try to parse the last valid JSON line
    # Iterate backwards through output lines to find JSON
    for line in reversed(output_lines):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
            
    return {}


def main():
    load_env() # Load environment variables first
    
    parser = argparse.ArgumentParser(description="AI Media Engine Orchestrator")
    parser.add_argument("--prompt", "-p", required=True, help="Description of asset")
    parser.add_argument("--type", "-t", choices=["image", "video"], required=True)
    parser.add_argument("--name", "-n", required=True, help="Filename (no extension)")
    args = parser.parse_args()
    
    # 0. Check system deps
    if not shutil.which("ffmpeg"):
        print("❌ Error: 'ffmpeg' is not installed or not in PATH.")
        print("  Mac: brew install ffmpeg")
        sys.exit(1)
        
    # 1. Setup Env
    ensure_venv()
    
    # 2. RUN GENERATOR
    print(f"🚀 Starting Asset Pipeline: {args.name} ({args.type})")
    gen_args = ["--type", args.type, "--prompt", args.prompt, "--name", args.name, "--output", str(PROJECT_ROOT)]
    
    try:
        gen_result = run_command_in_venv("media_generator.py", gen_args)
    except Exception as e:
        print(f"❌ Generator failed: {e}")
        sys.exit(1)
        
    if not gen_result:
        print("❌ Generator produced no output.")
        sys.exit(1)

    # 3. RUN PROCESSOR
    print("\n⚡ pipeline: handing off to processor...")
    
    proc_args = ["--name", args.name, "--output", str(PROJECT_ROOT)]
    
    if args.type == "image":
        # Expecting 'white' and 'black' keys
        if "white" not in gen_result or "black" not in gen_result:
             print(f"❌ Invalid generator output for image: {gen_result}")
             sys.exit(1)
        proc_args.extend(["--white", gen_result["white"], "--black", gen_result["black"]])
    else:
        # Expecting 'video' key
        if "video" not in gen_result:
            print(f"❌ Invalid generator output for video: {gen_result}")
            sys.exit(1)
        proc_args.extend(["--video", gen_result["video"]])

    try:
        proc_result = run_command_in_venv("media_processor.py", proc_args)
        
        # Success message
        print("\n✨ Pipeline Complete!")
        if "variants" in proc_result:
            print(f"   Created {len(proc_result['variants'])} variants.")
            for v in proc_result['variants']:
                 print(f"   - {v['scale']}: {Path(v['file']).relative_to(PROJECT_ROOT)}")
        elif "file" in proc_result:
             print(f"   Created: {Path(proc_result['file']).relative_to(PROJECT_ROOT)}")
             
    except Exception as e:
        print(f"❌ Processor failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
