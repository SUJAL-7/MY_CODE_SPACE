# ---------- Base stage (lightweight dev tools) ----------
FROM debian:bullseye-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc g++ make \
    python3 python3-pip \
    curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- App stage (orchestrator) ----------
FROM base AS orchestrator

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

RUN mkdir -p /workspaces

ENV NODE_ENV=production \
    SANDBOX_MODE=container \
    WORKSPACES_ROOT=/workspaces \
    FORCED_BASE_IMAGE=dev-base:latest \
    FORCED_NETWORK_MODE=bridge \
    ELEVATED_MODE=1 \
    RETAIN_CAP_DROP_ALL=0 \
    DISABLE_APT_SANDBOX=1 \
    AUTO_ENABLE_UNIVERSE=1 \
    ENABLE_APT_CAPS=1 \
    PROVISION_APT_PACKAGES="ca-certificates curl gnupg" \
    PROVISION_NODE=0 \
    PROVISION_NODE_VERSION=20 \
    SANDBOX_MEMORY=512m \
    SANDBOX_CPUS=1.0 \
    SANDBOX_AUTOREMOVE=true \
    USE_HOST_WORKSPACE=true \
    WORKSPACE_PATH=/workspace \
    DEBUG_SANDBOX=0

EXPOSE 8080
CMD ["node","server.js"]

# ---------- User dev container (lightweight with tools) ----------
FROM base AS dev-base

RUN apt-get update && apt-get install -y --no-install-recommends \
    nano vim wget unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["/bin/bash"]