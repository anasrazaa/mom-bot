# ── Stage 1: build the React/Vite app ────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Stage 2: serve via nginx ──────────────────────────────────────────────────
FROM nginx:1.27-alpine
RUN apk add --no-cache curl
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/index.html || exit 1
CMD ["nginx", "-g", "daemon off;"]
