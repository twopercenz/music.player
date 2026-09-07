# Runs the Next.js app as a single container. Audio extraction is no longer
# done in-process (see lib/companion.ts) — it's delegated to the separate
# invidious_companion service in docker-compose.yml, so this image doesn't
# need yt-dlp/ffmpeg at all anymore.

FROM oven/bun:1-debian AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# next.config.js sets output: "standalone" — server.js + only the
# node_modules it actually traced, instead of copying the whole project and
# a full node_modules into the final image.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN chown -R bun:bun /app

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/login || exit 1
CMD ["bun", "server.js"]
