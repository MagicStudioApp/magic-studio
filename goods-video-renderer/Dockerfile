FROM mcr.microsoft.com/playwright:v1.55.0-jammy

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY goods-video-renderer/package.json goods-video-renderer/pnpm-lock.yaml ./
RUN npm install -g pnpm@11.19.0 \
  && pnpm install --frozen-lockfile --prod
COPY goods-video-renderer/server.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
