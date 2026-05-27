# =============================================================================
# kais-core-backend (Toonflow Express Server)
# =============================================================================
# Strategy: copy pre-built bundle + pre-installed node_modules from host
# Avoids Docker build-time network issues (yarn install / npm registry)
# NOTE: better-sqlite3 must be rebuilt on host first (npm rebuild) to avoid
# GLIBC_2.38 mismatch — the host Ubuntu (glibc 2.39) links against newer
# symbols that bookworm-slim (glibc 2.36) cannot resolve.
#
# Architecture: app code lives in /app/serve/ (outside volume mount),
# user data lives in /app/data/ (mounted via named volume).
# This prevents the volume's stale app.js from overriding the image's.
# =============================================================================
FROM node:24-bookworm-slim

WORKDIR /app

# Copy production node_modules from host (already installed)
COPY node_modules/ ./node_modules/

# === App code — placed OUTSIDE /app/data/ to avoid volume override ===
# serve/ contains the esbuild bundle (app.js, env.js, err.js)
# This is build output and must always come from the image, never from volume.
COPY data/serve/ ./serve/

# === Static assets — placed in /app/image-assets/ for entrypoint sync ===
# These are copied to /app/data/ at container start (see entrypoint.sh)
# so the volume always gets the latest version from the image.
COPY data/web/ ./image-assets/web/
COPY data/vendor/ ./image-assets/vendor/
COPY data/version.txt ./image-assets/version.txt

# Strip electron artifacts if any
RUN rm -rf node_modules/electron node_modules/electron-builder 2>/dev/null; true

# Copy entrypoint script
COPY docker/core-backend/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create non-root user
RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD node -e "fetch('http://localhost:8000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "serve/app.js"]
