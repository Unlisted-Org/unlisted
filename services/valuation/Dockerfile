# Unlisted valuation API (spec 03). Build context: the repo root.
#   docker build -f services/valuation/Dockerfile .
# It needs only its own code, the fixture registry and the basket program's IDL. State (the saved
# basket and the watcher's event store) goes to DATA_DIR, which should be a persistent volume.
FROM node:24-slim
WORKDIR /app
COPY fixtures/registry.json fixtures/registry.json
COPY programs/basket/idl/basket.json programs/basket/idl/basket.json
COPY services/valuation/package.json services/valuation/package-lock.json services/valuation/
RUN cd services/valuation && npm ci --omit=dev --no-audit --no-fund
COPY services/valuation/src services/valuation/src
ENV CLUSTER=devnet \
    BASKET_SHARE_MINT=HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj \
    IDL_PATH=/app/programs/basket/idl/basket.json \
    DATA_DIR=/data \
    BASKET_REFRESH_S=60 \
    NODE_ENV=production
# MAINNET_RPC and DEVNET_RPC (the Helius URLs, with the key) come from the platform's secrets.
CMD ["node", "services/valuation/src/server.ts"]
