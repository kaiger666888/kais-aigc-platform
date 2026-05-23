# =============================================================================
# kais-movie-agent (调度中枢)
# =============================================================================
# Node.js 服务，未来计划迁移到 Python
# 负责: 工作流编排、任务调度、状态机管理
# =============================================================================
FROM node:20-slim

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com/

# 依赖文件先复制（层缓存优化）
COPY package.json yarn.lock* package-lock.json* ./

# TODO: 当 movie-agent 独立为子项目后，替换为实际的 package.json
RUN npm install --omit=dev && npm cache clean --force

# 复制源码
COPY src/ ./src/

RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8001

EXPOSE 8001

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD node -e "fetch('http://localhost:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
