FROM node:20-slim

WORKDIR /app

# git needed by lib/git-stage-manager.js (post-production phase)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Copy the movie-agent server code (zero npm deps, pure node:http)
COPY docker/movie-agent/src/ ./src/
COPY docker/movie-agent/lib/ ./lib/
COPY docker/movie-agent/shared/ ./shared/

RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8001

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD node -e "fetch('http://localhost:8001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
