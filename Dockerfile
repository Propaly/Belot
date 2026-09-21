# ---------- Build stage ----------
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

RUN git clone --depth 1 https://github.com/Propaly/Belot.git .

RUN npm ci

ARG VITE_WS_URL
ENV VITE_WS_URL=${VITE_WS_URL}

RUN npm run build


# ---------- Production stage ----------
FROM node:24-alpine

WORKDIR /app

RUN npm install -g serve

# We need the server dependencies/runtime
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

RUN npm ci --omit=dev

# Frontend
COPY --from=builder /app/dist ./dist

# WebSocket server (imports the shared engine from src/)
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src

ENV PORT=8787

EXPOSE 3000
EXPOSE 8787

# Run both processes
CMD ["sh", "-c", "node server/index.ts & serve -s dist -l 3000"]
