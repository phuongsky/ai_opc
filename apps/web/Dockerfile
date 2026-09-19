# Build & chạy Web Cockpit (apps/web) trong container.
# Build context là ROOT của monorepo (xem docker-compose.yml: context: .).
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @ai-opc/web... --frozen-lockfile || pnpm install --filter @ai-opc/web...

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter @ai-opc/web build

# Next.js output: "export" -> phục vụ file tĩnh bằng 1 static server nhẹ.
FROM node:20-alpine AS runner
RUN npm install -g serve
COPY --from=build /repo/apps/web/out /site
EXPOSE 3000
CMD ["serve", "-s", "/site", "-l", "3000"]
