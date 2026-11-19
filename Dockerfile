# syntax=docker/dockerfile:1
# Rep gym-tracker: one Bun container serving landing (/), web app (/app), API (/api) and MCP (/mcp).
# SQLite lives on a volume at /data (single writer -> run exactly ONE replica).

FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Production deps only (hono). Separate stage keeps the runtime layer clean.
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    GYM_DB=/data/gym.db \
    GYM_DIST=./dist \
    GYM_LANDING=./landing
# NB: GYM_DIST/GYM_LANDING must stay RELATIVE to WORKDIR. The SPA fallback in src/server/index.ts does
# serveStatic({ path: `${DIST}/index.html` }), and hono prefixes './' to that path, so an absolute
# /app/dist makes every deep link (/app/<route>) 404 in the container.
COPY package.json bun.lock* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY landing ./landing
COPY src ./src
# uid 10001 matches the k8s securityContext; /data is world-writable so any uid the
# platform picks can open the DB. The app itself writes nowhere else.
RUN mkdir -p /data && chown 10001:10001 /data && chmod 0777 /data
USER 10001:10001
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "src/server/index.ts"]
