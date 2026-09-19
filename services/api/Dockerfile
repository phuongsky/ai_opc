# Build & chạy Core Engine (services/api) trong container.
# Build context là ROOT của monorepo (xem docker-compose.yml: context: .)
# để pnpm workspace resolve được @ai-opc/shared.
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY services/api/package.json services/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @ai-opc/api... --frozen-lockfile || pnpm install --filter @ai-opc/api...

FROM deps AS build
COPY packages/shared packages/shared
COPY services/api services/api
RUN pnpm --filter @ai-opc/shared build 2>/dev/null || true
RUN pnpm --filter @ai-opc/api db:generate
RUN pnpm --filter @ai-opc/api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/services/api/dist services/api/dist
COPY --from=build /repo/services/api/node_modules services/api/node_modules
COPY --from=build /repo/services/api/package.json services/api/package.json
WORKDIR /repo/services/api
EXPOSE 8000
CMD ["node", "dist/index.js"]
