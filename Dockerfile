FROM node:22-alpine AS app

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY data ./data

RUN npm run build

CMD ["node", "dist/db/migrate.js"]
