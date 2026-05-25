# =============================================================================
# kais-core-backend (Toonflow Express Server)
# =============================================================================
# Strategy: copy pre-built bundle + pre-installed node_modules from host
# Avoids Docker build-time network issues (yarn install / npm registry)
# NOTE: better-sqlite3 must be rebuilt on host first (npm rebuild) to avoid
# GLIBC_2.38 mismatch — the host Ubuntu (glibc 2.39) links against newer
# symbols that bookworm-slim (glibc 2.36) cannot resolve.
# =============================================================================
FROM node:24-bookworm-slim

WORKDIR /app

# Copy production node_modules from host (already installed)
COPY node_modules/ ./node_modules/

# Copy pre-built app bundle (esbuild output)
COPY data/serve/ ./data/serve/

# Copy runtime data files
COPY data/version.txt ./data/version.txt

# Copy frontend static files
COPY data/web/ ./data/web/

# Copy vendor adapters (TTS, image, video providers)
COPY data/vendor/ ./data/vendor/

# Strip electron artifacts if any
RUN rm -rf node_modules/electron node_modules/electron-builder 2>/dev/null; true

# Create non-root user
RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD node -e "fetch('http://localhost:8000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "data/serve/app.js"]
