FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY mocks/package.json mocks/package.json
RUN npm ci
COPY tsconfig.json ./
COPY scripts/build.ts scripts/build.ts
COPY shared shared
COPY backend backend
COPY mocks mocks
RUN npm run build --workspace backend && npm run build --workspace mocks
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/shared ./shared
USER node

FROM runtime AS mocks
COPY --from=build --chown=node:node /app/mocks/dist ./mocks/dist
EXPOSE 4001
CMD ["node", "mocks/dist/main.js"]

FROM runtime AS backend
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]
