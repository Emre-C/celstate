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

# Config
FIXED_SEED = 12345
FRAME_COUNT = 81
BASE_PROMPT = "A stylized 3D 'Play' button pulsating and glowing. The background of this video is transparent. Premium UI design, soft shadows."

VARIATIONS = [
    {
        "name": "Button_Idle",
        "prompt": f"{BASE_PROMPT} Gentle idle animation, breathing, waiting to be clicked."
    },
    {
        "name": "Button_Press",
        "prompt": f"{BASE_PROMPT} Interaction: The button is pressed down firmly and compresses."
    },
    {
        "name": "Button_Release",
        "prompt": f"{BASE_PROMPT} Interaction: The button springs back up elastically after being pressed."
    }
]

def submit_request(test_case):
    url = f'https://api.runcomfy.net/prod/v1/deployments/{DEPLOYMENT_ID}/inference'
    headers = {
        'Authorization': f'Bearer {RUNCOMFY_API_KEY}',
        'Content-Type': 'application/json'
    }
    
    # Overrides for Seed (Node 3) and Length (Node 40)
    payload = {
        'overrides': {
            "40": { "inputs": { "length": FRAME_COUNT } },
            "3":  { "inputs": { "seed": FIXED_SEED } },
            "6":  { "inputs": { "text": test_case["prompt"] } }
        }
    }
    
    print(f"🚀 Submitting {test_case['name']} (Seed {FIXED_SEED}, 81 frames)...")
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
    headers = { 'Authorization': f'Bearer {RUNCOMFY_API_KEY}' }
    
    while True:
        pending = [r for r in active_requests if r['status'] not in ['SUCCESS', 'FAILED']]
        if not pending:
            print("\n🎉 All consistency tests completed!")
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
                
                if current_status == 'SUCCESS' or current_status == 'completed' or current_status == 'succeeded':
                    req['status'] = 'SUCCESS'
                    handle_success(req, data)
                elif current_status == 'FAILED' or current_status == 'failed':
                    req['status'] = 'FAILED'
                    print(f"❌ {req['name']} FAILED: {data}")
                    
            except Exception as e:
                print(f"⚠️ Error polling {req['name']}: {e}")
                
        time.sleep(10)

def handle_success(req, data):
    print(f"✨ {req['name']} SUCCEEDED! Downloading...")
    # Logic to find output URL similar to previous scripts ...
    # Simplified logic for brevity: check outputs, then result_url, then fallback
    
    zip_url = None
    outputs = data.get('outputs', {})
    for node_val in outputs.values():
        for img in node_val.get('images', []):
            url = img.get('url')
            if url and url.endswith('.zip'):
                zip_url = url
                break
            if url and url.endswith('_.webp'):
                 zip_url = url.replace('_.webp', '.zip')
        if zip_url: break
    
    if not zip_url:
        # Fallback guess
        req_id = req['request_id']
        zip_url = f"https://serverless-api-storage.runcomfy.net/deployment_requests/{req_id}/output/Wan_Alpha_00002.zip"
        print(f"   (Guessing ZIP URL: {zip_url})")

    fname = f"{req['name']}_{FRAME_COUNT}frames.zip"
    try:
        r = requests.get(zip_url)
        if r.status_code == 200:
            with open(fname, 'wb') as f:
                f.write(r.content)
            print(f"📥 Saved {fname}")
            
            # Verify frame count
            with zipfile.ZipFile(fname, 'r') as z:
                count = len([n for n in z.namelist() if n.endswith('.png')])
                print(f"   🔎 Verified {count} frames.")
        else:
            print(f"❌ Download failed: {r.status_code}")
    except Exception as e:
         print(f"❌ Download error: {e}")

if __name__ == "__main__":
    active_requests = []
    for test in VARIATIONS:
        res = submit_request(test)
        if res:
            active_requests.append(res)
            
    if active_requests:
        print("\n⏳ Starting polling loop...")
        poll_requests(active_requests)
