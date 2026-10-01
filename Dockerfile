# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

# Install root dependencies (server + build tools)
COPY package.json package-lock.json ./
RUN npm ci

# Install client dependencies
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:24-alpine AS runner

WORKDIR /app

# Install only production runtime dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled server output
COPY --from=builder /app/server/dist ./server/dist

# Copy built client static files
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 6767

ENV NODE_ENV=production

CMD ["node", "server/dist/server/src/index.js"]
