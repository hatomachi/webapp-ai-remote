FROM node:20-alpine

WORKDIR /app

# packages/hub の package.json をコピーして依存関係をインストール
COPY package.json ./
RUN npm install --omit=dev

# ソースコードをコピー
COPY src ./src

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/index.js"]
