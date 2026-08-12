#!/usr/bin/env python3
"""Queue the 二采重绘放大 API workflow and poll until it finishes. Prints the output mp4 path."""
import json, time, uuid, sys, urllib.request, os

HOST = os.environ.get("COMFY", "http://localhost:8188")
API = "/data/workspace/kais-aigc-platform/workflows/h3-redraw-upscale/h3_redraw_upscale_api.json"
OUTDIR = "/mnt/agents/output/gpu1"

prompt = json.load(open(API))
client_id = str(uuid.uuid4())
body = json.dumps({"prompt": prompt, "client_id": client_id}).encode()

req = urllib.request.Request(f"{HOST}/prompt", data=body, headers={"Content-Type": "application/json"})
try:
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
except urllib.error.HTTPError as e:
    print("PROMPT REJECTED:", e.code)
    print(e.read().decode())
    sys.exit(2)

if "error" in resp or "node_errors" in resp and resp.get("node_errors"):
    print("VALIDATION ERRORS:")
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:4000])
    sys.exit(3)

pid = resp["prompt_id"]
print(f"QUEUED prompt_id={pid}")

# poll /history
t0 = time.time()
last_status = None
while time.time() - t0 < 1800:  # 30 min cap
    try:
        h = json.loads(urllib.request.urlopen(f"{HOST}/history/{pid}", timeout=20).read())
    except Exception as e:
        print(f"  history poll error: {e}")
        time.sleep(10); continue
    if pid in h:
        rec = h[pid]
        status = rec.get("status", {})
        if status.get("completed"):
            outs = rec.get("outputs", {})
            print(f"COMPLETED in {time.time()-t0:.0f}s")
            # find mp4 outputs
            mp4s = []
            for nid, o in outs.items():
                for kind in ("gifs", "videos", "images", "audio"):
                    for item in o.get(kind, []):
                        fn = item.get("filename") or item.get("name")
                        if fn:
                            mp4s.append((nid, kind, fn, item.get("subfolder","")))
            if not mp4s:
                print("  outputs:", json.dumps(outs, ensure_ascii=False)[:2000])
            for nid, kind, fn, sub in mp4s:
                full = os.path.join(OUTDIR, sub, fn) if sub else os.path.join(OUTDIR, fn)
                print(f"  OUTPUT node={nid} kind={kind} file={full}")
            sys.exit(0)
        if status.get("status_str") == "error":
            print("EXECUTION ERROR:")
            print(json.dumps(status, indent=2, ensure_ascii=False)[:4000])
            msgs = rec.get("status", {}).get("messages", [])
            for m in msgs[-8:]:
                print("  msg:", m)
            sys.exit(4)
    # progress via queue
    try:
        q = json.loads(urllib.request.urlopen(f"{HOST}/queue", timeout=10).read())
        running = q.get("queue_running", [])
        pending = len(q.get("queue_pending", []))
        if running:
            print(f"  [{time.time()-t0:.0f}s] running... pending={pending}")
        elif pending:
            print(f"  [{time.time()-t0:.0f}s] pending={pending}")
        else:
            print(f"  [{time.time()-t0:.0f}s] not in queue, waiting for history...")
    except Exception:
        pass
    time.sleep(10)
print("TIMEOUT after 30 min")
sys.exit(5)
