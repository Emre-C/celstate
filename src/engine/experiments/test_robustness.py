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

TEST_CASES = [
    {
        "name": "Glass_Refraction",
        "prompt": "Cinematic close-up. A crystal sphere rotating slowly. The background of this video is transparent. Realistic lighting, refraction, caustics."
    },
    {
        "name": "Fine_Detail_Hair",
        "prompt": "Close up. A cute fluffy white monster looking left and right. Wispy fur blowing in gentle wind. The background of this video is transparent. Pixar style, soft lighting."
    },
    {
        "name": "Fast_Motion",
        "prompt": "A red rubber ball bouncing energetically. Motion blur. The background of this video is transparent. 60fps."
    },
    {
        "name": "UI_Component",
        "prompt": "A stylized 3D 'Play' button pulsating and glowing. Gentle idle animation. The background of this video is transparent. Premium UI design, soft shadows."
    }
]

def verify_alpha_in_zip(zip_path):
    print(f"🔎 Verifying alpha in {zip_path}...")
    try:
        transparent_frames = 0
        total_frames = 0
        with zipfile.ZipFile(zip_path, 'r') as z:
            pngs = [f for f in z.namelist() if f.lower().endswith('.png')]
            total_frames = len(pngs)
            for png_file in pngs:
                with z.open(png_file) as f:
                    img = Image.open(f)
                    if img.mode == 'RGBA':
                        extrema = img.getextrema()
                        alpha_extrema = extrema[3]
                        if alpha_extrema[0] < 255:
                            transparent_frames += 1
        
        print(f"   Found {transparent_frames}/{total_frames} frames with transparency.")
        return transparent_frames > 0
    except Exception as e:
        print(f"   ⚠️ Error verifying alpha: {e}")
        return False

def submit_request(test_case):
    url = f'https://api.runcomfy.net/prod/v1/deployments/{DEPLOYMENT_ID}/inference'
    headers = {
        'Authorization': f'Bearer {RUNCOMFY_API_KEY}',
        'Content-Type': 'application/json'
    }
    payload = {
        'overrides': {
            "6": {
                "inputs": {
                    "text": test_case["prompt"]
                }
            }
        }
    }
    
    print(f"🚀 Submitting {test_case['name']}...")
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        request_id = data.get('request_id')
        status_url = data.get('status_url')
        print(f"✅ Submitted {test_case['name']} -> ID: {request_id}")
        return {
            "name": test_case["name"],
            "request_id": request_id,
            "status_url": status_url,
            "status": "in_queue"
        }
    except Exception as e:
        print(f"❌ Failed to submit {test_case['name']}: {e}")
        return None

def poll_requests(active_requests):
    headers = {
        'Authorization': f'Bearer {RUNCOMFY_API_KEY}'
    }
    
    # Keep checking until all are done
    while True:
        pending = [r for r in active_requests if r['status'] not in ['SUCCESS', 'FAILED']]
        if not pending:
            print("\n🎉 All tests completed!")
            break
            
        print(f"\n--- Polling Status ({len(active_requests) - len(pending)}/{len(active_requests)} completed) ---")
        
        for req in pending:
            try:
                resp = requests.get(req['status_url'], headers=headers)
                resp.raise_for_status()
                data = resp.json()
                current_status = data.get('status')
                
                if current_status != req['status']:
                    print(f"🔄 {req['name']}: {req['status']} -> {current_status}")
                    req['status'] = current_status
                
                if current_status == 'SUCCESS':
                    handle_success(req, data)
                elif current_status == 'FAILED':
                    print(f"❌ {req['name']} FAILED: {data}")
                    
            except Exception as e:
                print(f"⚠️ Error polling {req['name']}: {e}")
                
        time.sleep(10)

def handle_success(req, data):
    print(f"✨ {req['name']} SUCCEEDED! Downloading...")
    outputs = data.get('outputs', {})
    if not outputs:
        # Try finding result_url if outputs is empty (fallback)
        result_url = data.get('result_url')
        if result_url:
             # Logic to fetch result_url if needed (RunComfy sometimes puts outputs there)
             pass

    for node_id, node_output in outputs.items():
        images = node_output.get('images', [])
        for img in images:
            url = img.get('url')
            if not url: continue
            
            # 1. Download basic output (likely WebP)
            fname = f"{req['name']}_{img['filename']}"
            download_file(url, fname)
            
            # 2. Try to derive Zip URL for raw frames
            # Heuristic: replace _.webp with .zip if looks like standard pattern
            if fname.endswith('_.webp'):
                 zip_url = url.replace('_.webp', '.zip')
                 zip_fname = f"{req['name']}_frames.zip"
                 print(f"🔎 Attempting to fetch ZIP: {zip_url}")
                 try:
                     download_file(zip_url, zip_fname)
                     verify_alpha_in_zip(zip_fname)
                 except Exception as e:
                     print(f"   (Zip fetch failed: {e})")

def download_file(url, filename):
    resp = requests.get(url)
    resp.raise_for_status()
    with open(filename, 'wb') as f:
        f.write(resp.content)
    print(f"📥 Saved {filename}")

if __name__ == "__main__":
    if not RUNCOMFY_API_KEY:
        print("❌ Error: RUNCOMFY_API_KEY not set.")
        exit(1)
        
    active_requests = []
    for test in TEST_CASES:
        res = submit_request(test)
        if res:
            active_requests.append(res)
    
    if active_requests:
        print("\n⏳ Starting polling loop...")
        poll_requests(active_requests)
