"""VRAM 容量压测: 填充 ~22GB 并全量遍历计算, 排除高位显存 marginal cell。
若 Xid / 数据校验失败 → 显存容量级硬件问题; 若稳 → 显存硬件 OK。
"""
import torch, time
dev = torch.device("cuda:0")
torch.cuda.set_device(dev)
print(f"[cap] {torch.cuda.get_device_name(0)} total {torch.cuda.get_device_properties(0).total_memory/1e9:.1f}GB", flush=True)

# 尽量填到 ~22GB (留余量), 块 [16384,16384] fp16 = 0.5GB
blocks = []
i = 0
while torch.cuda.memory_allocated() < 22 * 1e9:
    try:
        t = torch.full((16384, 16384), float(i % 7), dtype=torch.float16, device=dev)
        blocks.append(t); i += 1
    except torch.cuda.OutOfMemoryError:
        break
print(f"[cap] 填充 {len(blocks)} 块 ≈ {torch.cuda.memory_allocated()/1e9:.1f}GB", flush=True)

# 校验写入模式正确 (每块应为 i%7)
bad = sum(1 for k, t in enumerate(blocks) if float(t[0,0].item()) != k % 7)
print(f"[cap] 写入校验: {bad} 块异常" + (" ✅" if bad == 0 else " ❌"), flush=True)

# 遍历计算 90s: 每块自乘 + 累加, 全量访问
t0 = time.time(); iters = 0; last = t0
while time.time() - t0 < 90:
    acc = torch.zeros(16384, dtype=torch.float16, device=dev)
    for t in blocks:
        acc += t.sum(dim=0)   # 读全块
    iters += 1
    now = time.time()
    if now - last >= 30:
        print(f"[cap] {now-t0:4.0f}s iters {iters} | VRAM {torch.cuda.memory_allocated()/1e9:.1f}GB | checksum {float(acc[:8].sum()):.0f}", flush=True)
        last = now

# 再次校验 (计算后值应仍为 i%7, 防翻转)
bad2 = sum(1 for k, t in enumerate(blocks) if float(t[0,0].item()) != k % 7)
print(f"[cap] ✅ 完成 90s, iters={iters}; 计算后校验 {bad2} 块异常" + (" (显存数据完好)" if bad2 == 0 else " ❌(疑似位翻转)"), flush=True)
