# =============================================================================
# ComfyUI V8 → V9 迁移脚本
# =============================================================================
# 用途: 将现有 V8 ComfyUI 架构迁移到 V9 MEGAPAK 大一统双引擎
# 执行前确认:
#   1. MEGAPAK 镜像已拉取 (yanwk/comfyui-boot:cu130-megapak-pt211)
#   2. 旧镜像已备份到 /mnt/storage/backup/docker-images/comfyui-old/
#   3. 增量节点已复制到 /data/workspace/comfyui-incremental-nodes/
# =============================================================================

set -euo pipefail

COMPOSE_DIR="/home/kai/workspace/kais-aigc-platform"
COMPOSE_V8="$COMPOSE_DIR/docker-compose.v8.yml"
COMPOSE_V9="$COMPOSE_DIR/docker-compose.v9.yml"
BACKUP_DIR="/mnt/storage/backup/docker-images/comfyui-old"

echo "================================================"
echo " ComfyUI V8 → V9 迁移"
echo "================================================"

# ---------------------------------------------------------------------------
# Step 1: 停止 V8 引擎 (保留核心服务)
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 1: 停止 V8 ComfyUI 引擎 (保留 core-backend/redis/db)..."

# 停止碎片容器
for c in comfyui-redux comfyui-main comfyui-trellis comfyui-worker-backup-v4 comfyui-worker-backup-20260603 wan14b-t2v; do
  if docker ps -a --filter "name=$c" --format "{{.Names}}" | grep -q "$c"; then
    echo "  停止并删除: $c"
    docker stop "$c" 2>/dev/null || true
    docker rm "$c" 2>/dev/null || true
  fi
done

# 停止 V8 compose 中的 ComfyUI 引擎（保留其余服务）
cd "$COMPOSE_DIR"
docker compose -f "$COMPOSE_V8" stop comfyui-worker 2>/dev/null || true
docker compose -f "$COMPOSE_V8" rm -f comfyui-worker 2>/dev/null || true

echo "  ✅ V8 引擎已停止"

# ---------------------------------------------------------------------------
# Step 2: 备份旧镜像 (如未完成)
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 2: 检查旧镜像备份状态..."
for img_tag in "comfyui-worker:py312-v1" "comfyui-worker:pytorch251-v6" "comfyui-trellis:stable" "comfyui-worker:py312-joycaption" "comfyui-worker:pytorch251-v6-gcc"; do
  safe_name=$(echo "$img_tag" | tr ':/' '_')
  target="$BACKUP_DIR/${safe_name}.tar.gz"
  if [ ! -f "$target" ]; then
    if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "$img_tag"; then
      echo "  备份: $img_tag → $target"
      docker save "$img_tag" | gzip > "$target" &
    fi
  else
    size=$(du -sh "$target" | cut -f1)
    echo "  ✅ 已备份: $img_tag ($size)"
  fi
done

# ---------------------------------------------------------------------------
# Step 3: 加载 MEGAPAK 镜像
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 3: 加载 MEGAPAK 镜像..."

MEGAPAK_TAR="/mnt/storage/backup/docker-images/megapak-pt211.tar"
if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "yanwk/comfyui-boot:cu130-megapak-pt211"; then
  echo "  ✅ MEGAPAK 镜像已存在"
elif [ -f "$MEGAPAK_TAR" ]; then
  echo "  从 $MEGAPAK_TAR 加载..."
  docker load -i "$MEGAPAK_TAR"
  echo "  ✅ MEGAPAK 镜像已加载"
else
  echo "  ❌ 错误: MEGAPAK 镜像不存在且找不到 tar 文件"
  echo "  请先运行: HTTPS_PROXY=http://127.0.0.1:7890 crane pull yanwk/comfyui-boot:cu130-megapak-pt211 $MEGAPAK_TAR"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: 创建输出目录
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 4: 创建输出目录..."
sudo mkdir -p /mnt/agents/output/gpu0 /mnt/agents/output/gpu1
sudo chown -R kai:kai /mnt/agents/output
echo "  ✅ /mnt/agents/output/gpu0 和 gpu1 已创建"

# ---------------------------------------------------------------------------
# Step 5: 验证 V9 compose
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 5: 验证 V9 compose 配置..."
docker compose -f "$COMPOSE_V9" config --quiet
echo "  ✅ V9 compose 语法正确"

# ---------------------------------------------------------------------------
# Step 6: 启动双引擎
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 6: 启动 V9 双引擎..."
cd "$COMPOSE_DIR"
docker compose -f "$COMPOSE_V9" up -d comfyui-primary comfyui-auxiliary
echo "  等待引擎健康检查通过..."

# 等待健康检查
for service in comfyui-primary comfyui-auxiliary; do
  echo "  等待 $service ..."
  timeout 300 bash -c "
    until docker inspect $service --format '{{.State.Health.Status}}' 2>/dev/null | grep -q 'healthy'; do
      sleep 10
      echo -n '.'
    done
    echo ''
  " || echo "  ⚠️ $service 健康检查超时，请手动检查: docker logs $service"
done

# ---------------------------------------------------------------------------
# Step 7: 验证引擎
# ---------------------------------------------------------------------------
echo ""
echo ">>> Step 7: 验证引擎状态..."
echo ""
echo "  comfyui-primary (3090, :8188):"
curl -s http://localhost:8188/system_stats 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'    VRAM: {d.get(\"devices\":[{}])[0].get(\"vram_total\",0)/(1024**3):.1f} GB')
    print(f'    VRAM Free: {d.get(\"devices\":[{}])[0].get(\"vram_free\",0)/(1024**3):.1f} GB')
except: print('    ⚠️ 无法获取状态')
" 2>/dev/null || echo "    ❌ 无法连接"

echo ""
echo "  comfyui-auxiliary (3060Ti, :8189):"
curl -s http://localhost:8189/system_stats 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'    VRAM: {d.get(\"devices\":[{}])[0].get(\"vram_total\",0)/(1024**3):.1f} GB')
    print(f'    VRAM Free: {d.get(\"devices\":[{}])[0].get(\"vram_free\",0)/(1024**3):.1f} GB')
except: print('    ⚠️ 无法获取状态')
" 2>/dev/null || echo "    ❌ 无法连接"

echo ""
echo "================================================"
echo " V9 双引擎迁移完成"
echo "================================================"
echo ""
echo " 后续操作:"
echo "  1. 访问 http://localhost:8188 确认 primary 引擎正常"
echo "  2. 访问 http://localhost:8189 确认 auxiliary 引擎正常"
echo "  3. 在 gold-team 中更新路由配置指向新端点"
echo "  4. 验证通过后删除旧镜像释放磁盘空间"
echo ""
echo " 删除旧镜像 (验证通过后):"
echo "  docker rmi comfyui-worker:py312-v1 comfyui-trellis:stable comfyui-worker:py312-joycaption comfyui-worker:pytorch251-v6"
echo ""
echo " 回滚方案:"
echo "  docker compose -f $COMPOSE_V9 down comfyui-primary comfyui-auxiliary"
echo "  docker compose -f $COMPOSE_V8 up -d comfyui-worker"
