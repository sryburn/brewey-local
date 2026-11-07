FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
COPY LICENSE NOTICE.md ./
RUN npm run build

FROM node:24.15.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 zstd \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.159.2 --no-audit --no-fund \
    && mkdir -p /var/lib/brewey && chown node:node /var/lib/brewey
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/LICENSE /app/NOTICE.md ./
COPY --from=build --chown=node:node /app/src/lib/server ./src/lib/server
COPY --from=build --chown=node:node /app/src/lib/domain ./src/lib/domain
COPY --from=build --chown=node:node /app/src/types ./src/types
# Native administrator CLIs load source modules outside Next's bundled routes.
COPY --from=build --chown=node:node /app/node_modules/bcryptjs ./node_modules/bcryptjs
# Password recovery stays an operator-only CLI with private stdin/TTY input.
COPY --from=build --chown=node:node /app/scripts/recover-account.mjs ./ops/recover-account.mjs
COPY --from=build --chown=node:node /app/scripts/backup-sqlite.mjs ./ops/backup-sqlite.mjs
COPY --chown=node:node catalog/ ./catalog/
COPY --chown=node:node scripts/build-ingredients.py ./scripts/build-ingredients.py
COPY --chown=node:node scripts/ingredients/ ./scripts/ingredients/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
