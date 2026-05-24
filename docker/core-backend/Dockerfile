# =============================================================================
# kais-core-backend (Toonflow Express Server)
# =============================================================================
# Multi-stage: build with all deps, runtime with production deps only
# =============================================================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com/ && \
    yarn config set registry https://registry.npmmirror.com/

COPY package.json yarn.lock ./

# 剥离 Electron 相关依赖
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

# Install ALL deps (including devDeps for build tools like cross-env, esbuild)
RUN yarn install --frozen-lockfile && yarn cache clean

# Build TypeScript → data/serve/app.js (esbuild bundles with @/ alias)
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN yarn build

# =============================================================================
# Runtime stage — production deps only
# =============================================================================
FROM node:24-bookworm-slim

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com/

COPY package.json yarn.lock ./

# 剥离 Electron
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

# Install production deps + build native modules (better-sqlite3)
RUN yarn install --production --ignore-scripts && \
    cd node_modules/better-sqlite3 && \
    npx --yes prebuild-install --runtime napi --target 10 || \
    (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && \
     npx node-gyp rebuild --release && \
     apt-get purge -y python3 make g++ && apt-get autoremove -y && \
     rm -rf /var/lib/apt/lists/*) && \
    cd /app && yarn cache clean

# Copy built app from builder
COPY --from=builder /app/data/ ./data/

# 创建非 root 用户
RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD node -e "fetch('http://localhost:8000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "data/serve/app.js"]
