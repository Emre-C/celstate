import os
import requests
import json
import time
from dotenv import load_dotenv

def main():
    # Load environment variables from .env
    load_dotenv()
    
    token = os.environ.get('RUNCOMFY_API_KEY')
    if not token:
        print("Error: RUNCOMFY_API_KEY environment variable not set in .env or environment.")
        return

    # Deployment ID for the transparent video workflow
    deployment_id = "dfbd6f98-5a44-465f-a9f8-fdf9c3deddac"
    url = f'https://api.runcomfy.net/prod/v1/deployments/{deployment_id}/inference'
    
    headers = {
      'Authorization': f'Bearer {token}',
      'Content-Type': 'application/json'
    }
    
    # Prompt payload for a UI element
    ui_prompt = "A high-quality 3D stylized vibrant red heart pulsing gently. The background of this video is transparent. Realistic material, cinematic lighting. 60fps."
    
    payload = { 
        'overrides': {
            "6": {
                "inputs": {
                    "text": ui_prompt
                }
            }
        }
    }
    
    print(f"🚀 Sending inference request to RunComfy...")
    print(f"Prompt: {ui_prompt}")
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        print("✅ Response received:")
        print(json.dumps(data, indent=2))
        
        # RunComfy returns request_id and status_url
        request_id = data.get('request_id')
        status_url = data.get('status_url')
        
        if not request_id or not status_url:
            print("❌ No request_id or status_url found in response.")
            return

        print(f"⏳ Request started! ID: {request_id}")
        print(f"Polling status via: {status_url}")
        
        while True:
            status_resp = requests.get(status_url, headers=headers)
            status_resp.raise_for_status()
            status_data = status_resp.json()
            
            # The status response structure: {"status": "RUNNING", ...} or {"status": "SUCCESS", "outputs": [...]}
            status = status_data.get('status')
            print(f"Current status: {status}")
            
            if status == 'SUCCESS':
                print("✨ Request completed successfully!")
                
                # Check for output videos in status_data or result_url
                output_videos = []
                
                # Try to find output videos in the status response
                # Usually in status_data['results'] or similar
                results = status_data.get('results', {})
                for node_id, node_output in results.items():
                    if 'gifs' in node_output: # ComfyUI VideoCombine often uses 'gifs' key
                        for gif in node_output['gifs']:
                            if 'url' in gif:
                                output_videos.append(gif['url'])
                
                if not output_videos:
                    # Try result_url as fallback if status doesn't have it
                    result_url = data.get('result_url')
                    if result_url:
                        print(f"Checking result_url: {result_url}")
                        res_resp = requests.get(result_url, headers=headers)
                        res_resp.raise_for_status()
                        res_data = res_resp.json()
                        # Process res_data similarly
                        results = res_data.get('results', {})
                        for node_id, node_output in results.items():
                            if 'gifs' in node_output:
                                for gif in node_output['gifs']:
                                    if 'url' in gif:
                                        output_videos.append(gif['url'])

                if not output_videos:
                    print("❌ No output videos found.")
                    print(json.dumps(status_data, indent=2))
                    break
                
                # Download the first video found
                video_url = output_videos[0]
                print(f"📥 Downloading result from: {video_url}")
                
                video_resp = requests.get(video_url)
                video_resp.raise_for_status()
                
                filename = "ui_animation_transparent.mp4"
                with open(filename, 'wb') as f:
                    f.write(video_resp.content)
                
                print(f"✅ Saved to {filename}")
                break
                
            elif status == 'FAILED':
                print("❌ Request failed.")
                print(json.dumps(status_data, indent=2))
                break
                
            time.sleep(10) # Poll every 10 seconds
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
             print(f"Response content: {e.response.text}")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

if __name__ == "__main__":
    main()
