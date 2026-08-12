#!/usr/bin/env python3
"""Generate the Minimax H3 二采重绘放大 (second-sampling redraw-upscale) workflow.

Two sampler passes around `MiniMaxH3LatentUpscaleCombined` (Tr1dae):
  pass1 SamplerCustomAdvanced (low-res, full denoise) -> denoised_output
  -> MiniMaxH3LatentUpscaleCombined (spatial upscale + re-noise, scales ref conditioning)
  -> pass2 SamplerCustomAdvanced (DisableNoise + low sigmas) -> final high-res latent
  -> VAEDecode + VAEDecodeAudio -> CreateVideo

Produces two artifacts:
  h3_redraw_upscale_api.json  — API format ({node_id: {class_type, inputs}}), queueable via POST /prompt
  h3_redraw_upscale.json      — UI graph format, openable in the ComfyUI editor

Validates every class_type + input name against a live /object_info dump (path via $OI or
http://localhost:8188/object_info).
"""
import json, os, sys, urllib.request

OI_PATH = os.environ.get("OI", "/tmp/oi.json")

# ──────────────────────────────────────────────────────────────────────────────
# Model files verified present on this host (/data/models/comfyui/...)
# ──────────────────────────────────────────────────────────────────────────────
UNET      = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
CLIP      = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE_VID   = "minimax_h3_video_vae_fp16.safetensors"
VAE_AUD   = "minimax_h3_audio_vae_fp32.safetensors"

# Smoke-test defaults (conservative for 24GB int8; raise for quality once stable)
PROMPT     = ("A cinematic 16:9 shot: a young woman with long black hair sits at a café table by the "
              "window, gently stirring a cup of milk tea, soft afternoon sunlight, shallow depth of field, "
              "natural ambient café sounds, gentle clinking of cups.")
WIDTH_P1   = 864          # 0.4 MP 16:9 — pass 1 (cheap)
HEIGHT_P1  = 480
LENGTH     = 73           # ~3s @24fps, satisfies H3 length modular constraint
SCALE_BY   = 1.5          # pass1 0.4MP -> pass2 ~0.9MP (1296x720)
STEPS_P1   = 20           # full denoise
STEPS_P2   = 10           # low-sigma redraw
DENOISE_P2 = 0.35         # how much pass2 may rewrite (matched by audio_denoise)
AUDIO_DENOISE = 0.35      # 0 = lock pass-1 audio; 0.25-0.5 = light polish
SCHEDULER  = "beta"
SEED_P1    = 12345
SEED_P2    = 98765

# ──────────────────────────────────────────────────────────────────────────────
# API-format graph
# ──────────────────────────────────────────────────────────────────────────────
def api_workflow():
    W = {}
    W["unet"]       = {"class_type": "UNETLoader",      "inputs": {"unet_name": UNET, "weight_dtype": "default"}}
    W["clip"]       = {"class_type": "CLIPLoader",      "inputs": {"clip_name": CLIP, "type": "minimax", "device": "default"}}
    W["vae_video"]  = {"class_type": "VAELoader",       "inputs": {"vae_name": VAE_VID}}
    W["vae_audio"]  = {"class_type": "VAELoader",       "inputs": {"vae_name": VAE_AUD}}
    W["te_model"]   = {"class_type": "TESpeedMiniMaxH3","inputs": {"model": ["unet", 0], "processing_control_value": 0.12,
                              "processing_percent_1": 0.1, "processing_percent_2": 0.9, "mcs": 2, "device": "auto"}}

    # conditioning + initial low-res latent
    W["ref2va"]     = {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {
                              "clip": ["clip", 0], "vae": ["vae_video", 0], "audio_vae": ["vae_audio", 0],
                              "prompt": PROMPT, "width": WIDTH_P1, "height": HEIGHT_P1, "length": LENGTH,
                              "ref_image_size": "match"}}

    # pass 1: full denoise at low res
    W["noise1"]     = {"class_type": "RandomNoise",     "inputs": {"noise_seed": SEED_P1}}
    W["sampler"]    = {"class_type": "KSamplerSelect",  "inputs": {"sampler_name": "euler"}}
    W["sigmas1"]    = {"class_type": "BasicScheduler",  "inputs": {"model": ["te_model", 0], "scheduler": SCHEDULER, "steps": STEPS_P1, "denoise": 1.0}}
    W["guider1"]    = {"class_type": "BasicGuider",     "inputs": {"model": ["te_model", 0], "conditioning": ["ref2va", 0]}}
    W["pass1"]      = {"class_type": "SamplerCustomAdvanced", "inputs": {
                              "noise": ["noise1", 0], "guider": ["guider1", 0], "sampler": ["sampler", 0],
                              "sigmas": ["sigmas1", 0], "latent_image": ["ref2va", 1]}}

    # upscale + re-noise between passes (scales ref conditioning too)
    W["noise2"]     = {"class_type": "RandomNoise",     "inputs": {"noise_seed": SEED_P2}}
    W["sigmas2"]    = {"class_type": "BasicScheduler",  "inputs": {"model": ["te_model", 0], "scheduler": SCHEDULER, "steps": STEPS_P2, "denoise": DENOISE_P2}}
    W["upscaler"]   = {"class_type": "MiniMaxH3LatentUpscaleCombined", "inputs": {
                              "samples": ["pass1", 1],          # denoised_output of pass 1
                              "scale_by": SCALE_BY, "method": "bilinear",
                              "model": ["te_model", 0], "noise": ["noise2", 0], "sigmas": ["sigmas2", 0],
                              "audio_denoise": AUDIO_DENOISE,
                              "positive": ["ref2va", 0]}}        # scale minimax_refs to new canvas

    # pass 2: redraw detail at high res (DisableNoise — Combined already re-noised)
    W["disable_noise"] = {"class_type": "DisableNoise", "inputs": {}}
    W["guider2"]    = {"class_type": "BasicGuider",     "inputs": {"model": ["te_model", 0], "conditioning": ["upscaler", 1]}}
    W["pass2"]      = {"class_type": "SamplerCustomAdvanced", "inputs": {
                              "noise": ["disable_noise", 0], "guider": ["guider2", 0], "sampler": ["sampler", 0],
                              "sigmas": ["sigmas2", 0], "latent_image": ["upscaler", 0]}}

    # decode pass-2 latent
    W["decode_video"] = {"class_type": "VAEDecode",     "inputs": {"samples": ["pass2", 0], "vae": ["vae_video", 0]}}
    W["decode_audio"] = {"class_type": "VAEDecodeAudio","inputs": {"samples": ["pass2", 0], "vae": ["vae_audio", 0]}}
    W["create_video"] = {"class_type": "CreateVideo",   "inputs": {"images": ["decode_video", 0], "fps": 24, "audio": ["decode_audio", 0], "bit_depth": 8}}
    # terminal OUTPUT node (CreateVideo is intermediate, output_node=False)
    W["save_video"]   = {"class_type": "SaveVideo",     "inputs": {"video": ["create_video", 0], "filename_prefix": "h3_redraw_upscale", "format": "auto", "codec": "auto"}}
    return W


# ──────────────────────────────────────────────────────────────────────────────
# Validation against object_info
# ──────────────────────────────────────────────────────────────────────────────
def load_oi():
    if os.path.exists(OI_PATH):
        return json.load(open(OI_PATH))
    try:
        return json.load(urllib.request.urlopen("http://localhost:8188/object_info", timeout=15))
    except Exception as e:
        print(f"WARN: no object_info ({e}); skipping validation", file=sys.stderr)
        return None


def validate(api, oi):
    if not oi:
        return
    errors, warns = [], []
    for nid, node in api.items():
        ct = node["class_type"]
        if ct not in oi:
            errors.append(f"{nid}: unknown class_type {ct!r}")
            continue
        valid_inputs = set()
        for cat in ("required", "optional"):
            valid_inputs.update(oi[ct]["input"].get(cat, {}).keys())
        for k, v in node["inputs"].items():
            if k not in valid_inputs:
                errors.append(f"{nid} [{ct}]: input {k!r} not in {sorted(valid_inputs)}")
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                src, out = v
                if src not in api:
                    errors.append(f"{nid}.{k}: references missing node {src!r}")
                else:
                    src_ct = api[src]["class_type"]
                    src_outs = oi.get(src_ct, {}).get("output", [])
                    if out >= len(src_outs):
                        errors.append(f"{nid}.{k}: output idx {out} out of range for {src}({src_ct}) -> {src_outs}")
    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        [print("  ✗ " + e, file=sys.stderr) for e in errors]
        sys.exit(1)
    print(f"✓ validated {len(api)} nodes against object_info")


# ──────────────────────────────────────────────────────────────────────────────
# Convert API format -> UI graph format (grid layout)
# ──────────────────────────────────────────────────────────────────────────────
def to_ui_graph(api, oi):
    # topological order by following inputs
    order, seen = [], set()
    def visit(nid):
        if nid in seen:
            return
        seen.add(nid)
        for v in api[nid]["inputs"].values():
            if isinstance(v, list) and len(v) == 2 and v[0] in api:
                visit(v[0])
        order.append(nid)
    for nid in api:
        visit(nid)

    nodes, links = [], []
    link_id = [1]
    link_out = {}   # (src, out_idx) -> link_id
    pos_x, pos_y, col = 0, 0, 0

    def title_for(nid, ct):
        return {"MiniMaxH3LatentUpscaleCombined": "★ MiniMax H3 Latent Upscale (二采)",
                "SamplerCustomAdvanced": None}.get(ct, "")

    for nid in order:
        ct = api[nid]["class_type"]
        req = list(oi[ct]["input"].get("required", {}).keys())
        opt = list(oi[ct]["input"].get("optional", {}).keys())
        ordered_inputs = req + [o for o in opt if o in api[nid]["inputs"]]
        widgets, in_links = [], []
        for k in ordered_inputs:
            v = api[nid]["inputs"].get(k)
            if isinstance(v, list) and len(v) == 2 and v[0] in api:
                src, out = v
                key = (src, out)
                if key not in link_out:
                    link_out[key] = link_id[0]; link_id[0] += 1
                # ensure source node has an output slot registered (created with node)
                lid = link_out[key]
                in_links.append([lid, None])  # input slot index filled below
                in_links[-1][1] = len(in_links) - 1
                links.append([lid, src, out, nid, len([l for l in in_links]), ct])  # placeholder
            else:
                widgets.append(v)
        # rebuild links properly with input slot indices
        # (simpler: recompute)
        pass

    # The above got messy — do a clean second pass:
    nodes, links = [], []
    link_id = [1]
    nid_to_uinid = {n: i + 1 for i, n in enumerate(order)}
    input_slot_count = {n: 0 for n in order}

    # first pass: create nodes (so output slots exist)
    for idx, nid in enumerate(order):
        ct = api[nid]["class_type"]
        col = idx % 6
        row = idx // 6
        x = 80 + col * 320
        y = 80 + row * 260
        widgets = []
        req = list(oi[ct]["input"].get("required", {}).keys())
        opt = list(oi[ct]["input"].get("optional", {}).keys())
        keys = req + [o for o in opt if o in api[nid]["inputs"]]
        for k in keys:
            v = api[nid]["inputs"].get(k)
            if not (isinstance(v, list) and len(v) == 2 and v[0] in api):
                widgets.append(v)
        nodes.append({
            "id": nid_to_uinid[nid], "type": ct,
            "pos": [x, y], "size": {"0": 300, "1": max(100, 30 * len(keys))},
            "flags": {}, "order": idx, "mode": 0,
            "inputs": [], "outputs": [], "properties": {},
            "widgets_values": widgets,
            "title": title_for(nid, ct) or "",
        })
        # populate output slots from object_info
        for oi_idx in range(len(oi[ct]["output"])):
            nodes[-1]["outputs"].append({"name": oi[ct]["output_name"][oi_idx] if "output_name" in oi[ct] else f"out{oi_idx}",
                                          "type": oi[ct]["output"][oi_idx], "links": [], "slot_index": oi_idx})

    # second pass: links
    out_link_of = {}   # (nid, out_idx) -> link_id
    for nid in order:
        ct = api[nid]["class_type"]
        req = list(oi[ct]["input"].get("required", {}).keys())
        opt = list(oi[ct]["input"].get("optional", {}).keys())
        keys = req + [o for o in opt if o in api[nid]["inputs"]]
        target_node = next(nn for nn in nodes if nn["id"] == nid_to_uinid[nid])
        in_slot = 0
        for k in keys:
            v = api[nid]["inputs"].get(k)
            if isinstance(v, list) and len(v) == 2 and v[0] in api:
                src, out = v
                key = (src, out)
                if key not in out_link_of:
                    out_link_of[key] = link_id[0]; link_id[0] += 1
                lid = out_link_of[key]
                src_node = next(nn for nn in nodes if nn["id"] == nid_to_uinid[src])
                src_node["outputs"][out]["links"].append(lid)
                target_node["inputs"].append({"name": k, "type": oi[ct]["input"]["required"].get(k, oi[ct]["input"].get("optional", {}).get(k, ["?"]))[0], "link": lid})
                links.append([lid, nid_to_uinid[src], out, nid_to_uinid[nid], in_slot, target_node["type"]])
                in_slot += 1

    last_link = link_id[0] - 1
    return {"last_node_id": nid_to_uinid[order[-1]], "last_link_id": last_link,
            "nodes": nodes, "links": links, "groups": [], "config": {}, "extra": {},
            "version": 0.4}


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    api = api_workflow()
    oi = load_oi()
    validate(api, oi)

    api_path = os.path.join(here, "h3_redraw_upscale_api.json")
    with open(api_path, "w") as f:
        json.dump(api, f, indent=2, ensure_ascii=False)
    print(f"✓ wrote {api_path}")

    if oi:
        ui = to_ui_graph(api, oi)
        ui_path = os.path.join(here, "h3_redraw_upscale.json")
        with open(ui_path, "w") as f:
            json.dump(ui, f, ensure_ascii=False)
        print(f"✓ wrote {ui_path} ({len(ui['nodes'])} nodes, {len(ui['links'])} links)")
