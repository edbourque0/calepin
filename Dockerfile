# syntax=docker/dockerfile:1

# The build runs once, natively on the CI runner ($BUILDPLATFORM): the output is plain JavaScript
# with no native addons, so the same files work in the amd64 and arm64 images. Running the build
# under QEMU for arm64 crashed (illegal instruction) and was very slow.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 && pnpm --filter @calepin/server deploy --prod --legacy /out \
 && mkdir -p /data/backups

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web \
    BACKUP_DIR=/app/data/backups
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./web
# Writable data directory for local backups (mount a volume on /app/data).
COPY --from=build --chown=node:node /data /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
