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

# Pre-install twining-mcp globally for the plugin's .mcp.json (uses npx -y twining-mcp)
RUN npm install -g twining-mcp

# Clone Twining plugin from GitHub so the SDK can load it
RUN git clone --depth 1 https://github.com/daveangulo/twining-mcp.git /opt/twining-plugin

COPY --from=build /app/dist ./dist

# Volume mount point for persistent results
RUN mkdir -p /data/benchmark-results
VOLUME /data/benchmark-results

ENV RESULTS_DIR=/data/benchmark-results
ENV NODE_ENV=production
ENV TWINING_PLUGIN_PATH=/opt/twining-plugin/plugin

EXPOSE 3838

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["dashboard", "--port", "3838", "--results-dir", "/data/benchmark-results"]
