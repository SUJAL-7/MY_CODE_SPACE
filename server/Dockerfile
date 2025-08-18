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

# Workspace root on orchestrator container (host binds used inside user containers)
RUN mkdir -p /workspaces

EXPOSE 8080
CMD ["node","server.js"]