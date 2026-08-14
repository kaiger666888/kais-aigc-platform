"""裸 CUDA 压测: 脱离 ComfyUI, 纯 torch fp16 matmul 满载 + VRAM 填充。
跑 5 分钟。若期间触发 Xid 31 → 硬件问题; 若稳 → ComfyUI/lowvram 软件问题。
"""
import torch, time, sys

dev = torch.device("cuda:0")
torch.cuda.set_device(dev)
print(f"[stress] {torch.cuda.get_device_name(0)} | torch {torch.__version__}", flush=True)
print(f"[stress] VRAM total {torch.cuda.get_device_properties(0).total_memory/1e9:.1f} GB", flush=True)

# 填充 ~12GB VRAM (容量 + 带宽压力)
N = 12288
fillers = []
try:
    for i in range(8):  # 8 × 12288² × 2B ≈ 12 GB
        fillers.append(torch.randn(N, N, dtype=torch.float16, device=dev))
except torch.cuda.OutOfMemoryError:
    print(f"[stress] OOM 在填充第 {len(fillers)} 个张量, 用现有 {len(fillers)} 个继续", flush=True)
print(f"[stress] 填充 {len(fillers)} 张量 ≈ {sum(t.nelement()*2 for t in fillers)/1e9:.1f} GB", flush=True)
print(f"[stress] VRAM used {torch.cuda.memory_allocated()/1e9:.1f} GB", flush=True)

# 满载 matmul (tensor core)
a = torch.randn(N, N, dtype=torch.float16, device=dev)
b = torch.randn(N, N, dtype=torch.float16, device=dev)

DURATION = 300  # 5 min
t0 = time.time()
iters = 0
last = t0
while time.time() - t0 < DURATION:
    c = a @ b
    c = c @ a              # 双 matmul/iter, 提升算力
    a = 0.999 * a + 0.001 * c[:, :N]  # 写回, 防死代码消除
    iters += 1
    now = time.time()
    if now - last >= 30:
        torch.cuda.synchronize()
        # 每 30s 轮换一个 filler 写入 (进一步显存访问覆盖)
        for f in fillers[:3]:
            f.add_(1e-3)
        print(f"[stress] {now-t0:5.0f}s | iters {iters} | VRAM {torch.cuda.memory_allocated()/1e9:.1f}GB", flush=True)
        last = now

torch.cuda.synchronize()
print(f"[stress] ✅ 完成 {DURATION}s, iters={iters}, max_alloc {torch.cuda.max_memory_allocated()/1e9:.1f}GB", flush=True)
print(f"[stress] 末尾显存峰值/已用: {torch.cuda.max_memory_allocated()/1e9:.1f}GB / {torch.cuda.memory_allocated()/1e9:.1f}GB", flush=True)
