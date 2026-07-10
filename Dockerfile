FROM docker.m.daocloud.io/library/node:20-alpine AS client-builder

WORKDIR /app
COPY client/package*.json ./client/
RUN npm --prefix client ci --registry=https://registry.npmmirror.com
COPY client/ ./client/
RUN npm --prefix client run build

FROM docker.m.daocloud.io/library/node:20-slim AS runner

WORKDIR /app
COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev \
    --registry=https://registry.npmmirror.com \
    --better-sqlite3-binary-host=https://registry.npmmirror.com/-/binary/better-sqlite3

COPY server/src ./server/src
COPY server/seed ./server/seed
COPY --from=client-builder /app/client/dist ./client/dist

RUN mkdir -p /app/server/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/server/data
EXPOSE 3000

CMD ["node", "server/src/index.js"]
