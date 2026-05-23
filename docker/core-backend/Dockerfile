# =============================================================================
# kais-core-backend (Toonflow Express Server)
# =============================================================================
# 基于 Toonflow 现有 Dockerfile，适配 V6 平台
# 剥离 Electron 依赖，纯后端服务
# FROM node:24-bookworm-slim — 保持与原 Toonflow Dockerfile 一致
# =============================================================================
FROM node:24-bookworm-slim

WORKDIR /app

# 国内镜像加速
RUN npm config set registry https://registry.npmmirror.com/ && \
    yarn config set registry https://registry.npmmirror.com/

# 先复制依赖文件，利用 Docker 层缓存
COPY package.json yarn.lock ./

# 剥离 Electron 相关依赖，避免下载桌面二进制
RUN node -e "\
const fs = require('fs');\
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));\
for (const section of ['dependencies', 'devDependencies']) {\
  if (!pkg[section]) continue;\
  for (const name of ['custom-electron-titlebar', 'electron', 'electron-builder', 'electron-rebuild', 'electronmon']) {\
    delete pkg[section][name];\
  }\
}\
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');"

RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# 复制源码并构建
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# 构建 TypeScript
RUN yarn build || true

# 复制运行时数据
COPY data/ ./data/

# 创建非 root 用户
RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

# Health check endpoint 已在应用内实现
CMD ["node", "data/serve/app.js"]
