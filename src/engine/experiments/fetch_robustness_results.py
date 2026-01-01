import os
import requests
import json
import zipfile
from PIL import Image
from io import BytesIO
from dotenv import load_dotenv

load_dotenv()
RUNCOMFY_API_KEY = os.environ.get('RUNCOMFY_API_KEY')
DEPLOYMENT_ID = "dfbd6f98-5a44-465f-a9f8-fdf9c3deddac"

REQUESTS = {
    "Glass_Refraction": "849d6fdf-5b9b-47aa-85ab-4b6ef7cacebd",
    "Fine_Detail_Hair": "180df70c-70bd-405c-8b03-1b7c95b2b395",
    "Fast_Motion": "379d5e89-7d1a-4225-b498-0ea15ecb6d0a",
    "UI_Component": "e1e4011f-bf68-4b4d-8469-6812546fdfd1"
}

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
        return transparent_frames, total_frames
    except Exception as e:
        print(f"   ⚠️ Error: {e}")
        return 0, 0

def fetch_results():
    headers = {'Authorization': f'Bearer {RUNCOMFY_API_KEY}'}
    
    for name, req_id in REQUESTS.items():
        print(f"\n📥 Fetching {name} ({req_id})...")
        url = f"https://api.runcomfy.net/prod/v1/deployments/{DEPLOYMENT_ID}/requests/{req_id}/result"
        
        try:
            resp = requests.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            
            # Find output URL (Zip preferred, or WebP then derive Zip)
            output_url = None
            outputs = data.get('outputs', {})
             
            # Standard RunComfy structure: outputs -> "NODE_ID" -> images -> url
            for node_val in outputs.values():
                images = node_val.get('images', [])
                for img in images:
                    if 'url' in img:
                        candidate = img['url']
                        # Prioritize Zip if listed directly
                        if candidate.endswith('.zip'):
                            output_url = candidate
                            break
                        # Otherwise take WebP and we'll try to guess Zip
                        if candidate.endswith('.webp'):
                             output_url = candidate # Placeholder
            
            if not output_url:
                print(f"   ❌ No output URL found in response.")
                continue

            # Always try to fetch the ZIP version for alpha
            zip_url = output_url.replace('_.webp', '.zip') if output_url.endswith('_.webp') else output_url
            if not zip_url.endswith('.zip'):
                 # It might be a direct link to a file that isn't a zip, but for this workflow we expect frames.zip
                 # Let's try appending/modifying if needed, or just warn.
                 print(f"   ⚠️ URL doesn't look like a zip: {zip_url}")
            
            print(f"   ⬇️ Downloading {zip_url}...")
            zip_resp = requests.get(zip_url)
            if zip_resp.status_code == 200:
                fname = f"{name}_frames.zip"
                with open(fname, 'wb') as f:
                    f.write(zip_resp.content)
                
                t_frames, total = verify_alpha_in_zip(fname)
                if t_frames > 0:
                    print(f"   ✅ SUCCESS: {t_frames}/{total} transparent frames.")
                else:
                    print(f"   ❌ FAILURE: No transparency found.")
            else:
                print(f"   ❌ Failed to download zip: {zip_resp.status_code}")

        except Exception as e:
            print(f"   ❌ Error: {e}")

if __name__ == "__main__":
    fetch_results()
