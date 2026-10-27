FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js app.js index.html monitor.html admin.html styles.css backend.css streaming-controls.css monitoring.css monitor-dashboard.css monitor-dashboard.js admin-dashboard.css admin-monitor.css admin-theme.css admin-dashboard.js home-climate.js national-climate.js firebase-client.js firebase-messaging-sw.js ./
COPY assets ./assets
RUN mkdir -p assets/hls && cp node_modules/hls.js/dist/hls.min.js assets/hls/hls.min.js
EXPOSE 3000 3012
CMD ["node", "server.js"]
