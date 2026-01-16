"""
Experiment: Explore V2 Interpreter (Text-to-Transparency)

Verifies:
1. Interpreter correctly expands prompts using Gemini 2.5 Flash Image.
2. Service orchestrates Text -> Interp -> Image -> Transparency.
3. Artifacts are saved correctly.
"""

import sys
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), "../../../"))

# Load environment variables
load_dotenv()

from src.celstate_v2.service import CelstateService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    service = CelstateService()
    
    prompt = "A glass pill container"
    logger.info(f"Starting Text-to-Transparency for: '{prompt}'")
    
    try:
        result = service.create_from_text(
            prompt=prompt,
            style_context="Studio Ghibli, Whimsical, High Fidelity",
            render_size_hint=512
        )
        
        job_id = result["job_id"]
        logger.info(f"Job Initialized: {job_id}")
        
        # Verify artifacts
        job_dir = Path("jobs") / job_id
        
        prompts_file = job_dir / "studio" / "prompts.txt"
        if prompts_file.exists():
            logger.info(f"Prompts saved to: {prompts_file}")
            with open(prompts_file, "r") as f:
                print("\n--- Prompts ---")
                print(f.read())
                print("---------------\n")
        else:
            logger.error("Prompts file NOT found!")
            
        final_output = job_dir / "outputs" / "transparent.png"
        if final_output.exists():
             logger.info(f"Final saved to: {final_output}")
        else:
             logger.error("Final output NOT found!")
             
        logger.info("Success!")

    except Exception as e:
        logger.error(f"Failed: {e}", exc_info=True)

if __name__ == "__main__":
    main()
