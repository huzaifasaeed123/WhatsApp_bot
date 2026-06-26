FROM node:20-slim

# Install Chromium and the libraries Puppeteer/whatsapp-web.js need to run headless.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer NOT to download its own Chrome — we use the system Chromium above.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Persisted WhatsApp auth lives here — mount a Coolify volume at this path.
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache

EXPOSE 3000

CMD ["node", "index.js"]
