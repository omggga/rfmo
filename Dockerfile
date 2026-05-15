FROM node:24.15.0-bookworm-slim

WORKDIR /home/node/app

ENV NODE_ENV=production

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node README.md LICENSE ./

USER node

CMD ["node", "src/cli.js"]
