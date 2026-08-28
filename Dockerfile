# Runs the whole app (Next.js + the yt-dlp/ffmpeg audio extraction it shells
# out to from lib/extract.ts) as a single container — see the "Fly.io" / Render
# discussion in the project plan for why this can't be a Vercel deployment.

FROM oven/bun:1-debian AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp binary — no Python install required.
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["bun", "run", "start"]
