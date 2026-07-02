FROM node:20-bookworm-slim AS build

WORKDIR /app

ENV HUSKY=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages/voila-sdk/package.json packages/voila-sdk/package.json
COPY packages/voila-mcp/package.json packages/voila-mcp/package.json
COPY packages/voila-cli/package.json packages/voila-cli/package.json

RUN corepack enable \
  && corepack prepare pnpm@10.29.3 --activate \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @firfi/voila-sdk build \
  && pnpm --filter @firfi/voila-mcp build

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PATH=/mcp
ENV PORT=8080
ENV VOILA_GUEST=1

EXPOSE 8080

COPY --from=build /app/packages/voila-mcp/dist ./packages/voila-mcp/dist

CMD ["node", "packages/voila-mcp/dist/bin.cjs"]
