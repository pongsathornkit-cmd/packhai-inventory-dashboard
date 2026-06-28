FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && npm install \
  && npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8123
ENV SELLER_HEADLESS=1
ENV SYNC_REQUIRE_KEY=0
ENV PACKHAI_DATA_DIR=/app/storage/data
ENV PACKHAI_AUTH_STATE_DIR=/app/storage/auth-states
ENV FLOW_PROFILE=/app/storage/browser-profiles/flowaccount
ENV SHOPEE_SESSION_DIR=/app/storage/browser-profiles/shopee
ENV SELLER_SESSION_DIR=/app/storage/browser-profiles/lazada

EXPOSE 8123

CMD ["npm", "start"]
