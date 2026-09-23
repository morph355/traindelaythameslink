# Build stage: compile TypeScript.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies + compiled output only.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public

EXPOSE 3000
# Env vars (RTT_*, AGENTMAIL_*, APP_USERNAME/APP_PASSWORD, PORT) come from
# the container's environment (docker-compose env_file), not baked into
# the image - see docker-compose.yml and .env.example.
CMD ["node", "dist/server/index.js"]
