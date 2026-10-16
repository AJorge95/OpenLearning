FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY scripts/install-git-hooks.js ./scripts/install-git-hooks.js
RUN npm ci

COPY . .
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM node:24-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/AJorge95/OpenLearning"

ENV NODE_ENV=production \
    PORT=5173 \
    DATA_DIR=/var/lib/openlearning \
    BACKUP_DIR=/var/backups/openlearning

WORKDIR /app
COPY package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/openlearning /var/backups/openlearning \
    && chown -R node:node /var/lib/openlearning /var/backups/openlearning

COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts/backup.js ./scripts/backup.js
COPY --from=build --chown=node:node /app/scripts/start.js ./scripts/start.js
COPY --from=build --chown=node:node /app/dist/client ./dist/client

USER node
EXPOSE 5173
STOPSIGNAL SIGTERM
CMD ["node", "scripts/start.js"]
