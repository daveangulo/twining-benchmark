# Build stage
FROM node:22 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Volume mount point for persistent results
RUN mkdir -p /data/benchmark-results
VOLUME /data/benchmark-results

ENV RESULTS_DIR=/data/benchmark-results
ENV NODE_ENV=production

EXPOSE 3838

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["dashboard", "--port", "3838", "--results-dir", "/data/benchmark-results"]
