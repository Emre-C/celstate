import os
import requests
import json
import time
import zipfile
from PIL import Image
from io import BytesIO
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

RUNCOMFY_API_KEY = os.environ.get('RUNCOMFY_API_KEY')
DEPLOYMENT_ID = "dfbd6f98-5a44-465f-a9f8-fdf9c3deddac"

# Test config
PROMPT = "Cinematic close-up. A crystal sphere rotating slowly. The background of this video is transparent. Realistic lighting, refraction, caustics."
FRAME_COUNT = 81  # Target ~5 seconds at 16fps
SEED = 42

def verify_frame_count(zip_path):
    print(f"🔎 Verifying frames in {zip_path}...")
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            pngs = [f for f in z.namelist() if f.lower().endswith('.png')]
            count = len(pngs)
            print(f"   Found {count} PNG frames.")
            return count
    except Exception as e:
        print(f"   ⚠️ Error reading zip: {e}")
        return 0

def run_long_test():
    url = f'https://api.runcomfy.net/prod/v1/deployments/{DEPLOYMENT_ID}/inference'
    headers = {
        'Authorization': f'Bearer {RUNCOMFY_API_KEY}',
        'Content-Type': 'application/json'
    }
    
    # Construct payload with OVERRIDES
    # Node 40 = EmptyHunyuanLatentVideo (inputs: width, height, length, batch_size)
    # Node 6  = CLIPTextEncode (inputs: text, clip)
    # Node 3  = KSampler (inputs: seed, etc.)
    
    payload = {
        'overrides': {
            "40": {
                "inputs": {
                    "length": FRAME_COUNT
                }
            },
            "6": {
                "inputs": {
                    "text": PROMPT
                }
            },
            "3": {
                "inputs": {
                    "seed": SEED
                }
            }
        }
    }
    
    print(f"🚀 Submitting Long Duration Test ({FRAME_COUNT} frames, Seed {SEED})...")
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        request_id = data.get('request_id')
        status_url = data.get('status_url')
        print(f"✅ Submitted -> ID: {request_id}")
    except Exception as e:
        print(f"❌ Submission failed: {e}")
        return

    # Poll for completion
    print("⏳ Waiting for generation...")
    while True:
        try:
            resp = requests.get(status_url, headers={'Authorization': f'Bearer {RUNCOMFY_API_KEY}'})
            resp.raise_for_status()
            status_data = resp.json()
            status = status_data.get('status')
            
            if status == 'in_queue':
                print(f"   Status: in_queue (Position: {status_data.get('queue_position')})")
            elif status == 'in_progress':
                print("   Status: in_progress...")
            elif status == 'completed' or status == 'succeeded': # API varies
                print("✨ Job Completed!")
                handle_success(status_data, request_id)
                break
            elif status == 'failed':
                print(f"❌ Job Failed: {status_data}")
                break
            
            time.sleep(10)
            
        except Exception as e:
             print(f"⚠️ Polling error: {e}")
             time.sleep(10)

def handle_success(data, req_id):
    outputs = data.get('outputs', {})
    # Fallback if outputs missing but result_url present
    if not outputs and 'result_url' in data:
         # In a real tool we might fetch result_token etc, but let's assume standard output format first
         pass

    # Look for zip in outputs
    zip_url = None
    for node_val in outputs.values():
        for img in node_val.get('images', []):
            url = img.get('url')
            if url and url.endswith('.zip'):
                zip_url = url
                break
            if url and url.endswith('_.webp'):
                 # Try to guess zip
                 zip_url = url.replace('_.webp', '.zip')
        if zip_url: break
    
    if not zip_url:
        print("❌ No ZIP output found in response.")
        # Try brute force guess based on pattern if verified before
        zip_url = f"https://serverless-api-storage.runcomfy.net/deployment_requests/{req_id}/output/Wan_Alpha_00002.zip"
        print(f"   Attempting fallback URL: {zip_url}")

    print(f"⬇️ Downloading {zip_url}...")
    try:
        r = requests.get(zip_url)
        if r.status_code == 200:
            fname = "long_test_frames.zip"
            with open(fname, 'wb') as f:
                f.write(r.content)
            
            count = verify_frame_count(fname)
            if count == FRAME_COUNT:
                print(f"✅ SUCCESS: Generated exactly {count} frames!")
            else:
                print(f"⚠️ MISMATCH: Generated {count} frames (Expected {FRAME_COUNT}).")
        else:
            print(f"❌ Download failed: {r.status_code}")
    except Exception as e:
        print(f"❌ Download error: {e}")

if __name__ == "__main__":
    run_long_test()
