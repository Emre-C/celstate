import sys
from pathlib import Path
import time
import threading

# Add src to python path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from src.engine.core.job_store import JobStore
from src.mcp_server import get_asset, job_store

def test_polling_logic():
    print("--- Testing Polling Logic ---")
    
    # 1. Create a job manually via job_store
    job = job_store.create_job(
        asset_type="container",
        prompt="Test prompt",
        style_context="Test style"
    )
    job_id = job["id"]
    print(f"Created job: {job_id}")
    
    # 2. Verify status immediately (should be queued -> processing)
    response = get_asset(job_id)
    print(f"Immediate Poll Status: {response.get('status')}")
    print(f"Retry After: {response.get('retry_after')}")
    
    if response.get("status") == "processing" and response.get("retry_after") == 10:
        print("✅ Correctly mapped 'queued' to 'processing' with retry_after")
    else:
        print(f"❌ Failed: Expected processing/10, got {response.get('status')}/{response.get('retry_after')}")
        
    # 3. Simulate "running" state
    job["status"] = "running"
    job_store.save_job(job_id, job)
    
    response = get_asset(job_id)
    if response.get("status") == "processing":
         print("✅ Correctly mapped 'running' to 'processing'")
    else:
         print(f"❌ Failed: Expected processing, got {response.get('status')}")

    # 4. Simulate "succeeded" state
    job["status"] = "succeeded"
    job["component"] = {"manifest": {}, "assets": {}} # Dummy component
    job_store.save_job(job_id, job)
    
    response = get_asset(job_id)
    if response.get("status") == "succeeded":
         print("✅ Correctly returned 'succeeded'")
    else:
         print(f"❌ Failed: Expected succeeded, got {response.get('status')}")

def test_atomic_writes():
    print("\n--- Testing Atomic Writes (Race Condition Simulation) ---")
    
    job = job_store.create_job(asset_type="icon", prompt="Atomic test", style_context="style")
    job_id = job["id"]
    
    stop_event = threading.Event()
    
    def writer_loop():
        count = 0
        while not stop_event.is_set():
            job = job_store.get_job(job_id)
            if job:
                job["api_counter"] = count
                job_store.save_job(job_id, job)
                count += 1
            # time.sleep(0.001) # Very tight loop to force race
            
    def reader_loop():
        success_count = 0
        fail_count = 0
        while not stop_event.is_set():
            try:
                # Direct file read to verify integrity (or use get_job)
                # usage of get_job calls json.load which will fail if file is partial
                data = job_store.get_job(job_id)
                if data:
                    success_count += 1
            except json.JSONDecodeError:
                fail_count += 1
                print("❌ JSON Decode Error detected! Atomic write failed.")
            except Exception as e:
                fail_count += 1
                print(f"❌ Read Error: {e}")
                
        return success_count, fail_count

    writer_thread = threading.Thread(target=writer_loop)
    
    # Run reader in main thread or separate? Separate for control.
    # Actually we just run reader loop here.
    
    writer_thread.start()
    
    print("Running r/w race for 2 seconds...")
    start_time = time.time()
    errors = 0
    reads = 0
    
    while time.time() - start_time < 2:
        try:
            job = job_store.get_job(job_id)
            if job:
                reads += 1
        except Exception as e:
            print(f"Error during race: {e}")
            errors += 1
            
    stop_event.set()
    writer_thread.join()
    
    print(f"Completed {reads} reads with {errors} errors.")
    if errors == 0:
        print("✅ Atomic write test passed: No corrupt reads during high-concurrency IO.")
    else:
        print("❌ Atomic write test failed.")

if __name__ == "__main__":
    test_polling_logic()
    test_atomic_writes()
