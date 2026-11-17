FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV CI=1
RUN npm run build && npm run setup:pose && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build --chmod=644 /app/.data/movenet-thunder.onnx /app/models/movenet-thunder.onnx
ENV NODE_ENV=production HOST=0.0.0.0 TRAINER_PLUS_POSE_MODEL=/app/models/movenet-thunder.onnx
USER node
CMD ["node", "server/index.mjs"]
