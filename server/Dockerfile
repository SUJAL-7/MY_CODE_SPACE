FROM node:20-bullseye

# Install minimal extras (git optional if you want git in orchestrator only)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates git python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=production \
    SANDBOX_MODE=container \
    WORKSPACES_ROOT=/workspaces \
    SANDBOX_BASE_IMAGE=node:20-bullseye \
    SANDBOX_MEMORY=512m \
    SANDBOX_CPUS=1.0 \
    SANDBOX_NETWORK_MODE=none \
    SANDBOX_AUTOREMOVE=true

# Workspace root on orchestrator container (host binds used inside user containers)
RUN mkdir -p /workspaces

EXPOSE 8080
CMD ["node","server.js"]