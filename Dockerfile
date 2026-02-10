FROM node:20-slim AS base

FROM base AS deps
WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app

RUN corepack enable pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_CACHE=0
ENV NEXT_PUBLIC_CACHE=${NEXT_PUBLIC_CACHE}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

FROM base AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /app/.venv
COPY backend/requirements.txt ./backend/requirements.txt
RUN /app/.venv/bin/pip install --no-cache-dir -r backend/requirements.txt

ARG ROBOFLOW_API_KEY
ARG SKIP_DETECTION=0

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV FLASK_API_URL=http://localhost:5001
ENV FLASK_PORT=5001
ENV ROBOFLOW_API_KEY=${ROBOFLOW_API_KEY}
ENV SKIP_DETECTION=${SKIP_DETECTION}

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY backend ./backend

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

EXPOSE 3000 5001

CMD ["./entrypoint.sh"]
