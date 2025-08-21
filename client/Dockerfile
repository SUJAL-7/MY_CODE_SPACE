# Simple optimized single-stage build
FROM node:20-bullseye AS client

WORKDIR /app

# Environment variable passed into Vite (adjust if different)
# ARG VITE_BACKEND_URL=http://192.168.66.16:8080/
# ENV VITE_REACT_APP_SERVER_URL=${VITE_BACKEND_URL}

# Copy manifests only (ensure package-lock.json exists!)
COPY package*.json ./

# Install dependencies (use BuildKit cache for speed)
# BuildKit must be enabled: DOCKER_BUILDKIT=1 docker build ...
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Copy the rest of the source
COPY . .

# Build production bundle
RUN npm run build

# Expose port; use Vite preview (or switch to static server later)
EXPOSE 3000
CMD ["npx","vite","preview","--host","0.0.0.0","--port","3000"]