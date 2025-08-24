import path from "path";

export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || path.join(process.cwd(), "workspaces");

export const FORCED_BASE_IMAGE = (process.env.FORCED_BASE_IMAGE || "dev-base:latest").trim();

export const ALLOWLIST_IMAGES = (process.env.ALLOWLIST_IMAGES || FORCED_BASE_IMAGE)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const DIGEST_REQUIRED = (process.env.DIGEST_REQUIRED || "false") === "true";
export const NETWORK_MODE = process.env.FORCED_NETWORK_MODE || "bridge";

export let READONLY_ROOT = (process.env.READONLY_ROOT || "false") === "true";
export let SANDBOX_MEMORY = process.env.SANDBOX_MEMORY || "1g";
export let SANDBOX_CPUS = process.env.SANDBOX_CPUS || "1.0";
export const SANDBOX_AUTOREMOVE = process.env.SANDBOX_AUTOREMOVE !== "false";
export const SANDBOX_RUNTIME = process.env.SANDBOX_RUNTIME || "";

export const RETAIN_CAP_DROP_ALL = (process.env.RETAIN_CAP_DROP_ALL || "1") === "1";
export const ALLOWED_EXTRA_CAPS = (process.env.ALLOWED_EXTRA_CAPS || "").split(/\s+/).filter(Boolean);

export const SANDBOX_PIDS_LIMIT = parseInt(process.env.SANDBOX_PIDS_LIMIT || "0", 10);
export const ULIMIT_NOFILE = parseInt(process.env.ULIMIT_NOFILE || "0", 10);
export const ULIMIT_NPROC = parseInt(process.env.ULIMIT_NPROC || "0", 10);

export const BLKIO_READ_BPS = parseInt(process.env.BLKIO_READ_BPS || "0", 10);
export const BLKIO_WRITE_BPS = parseInt(process.env.BLKIO_WRITE_BPS || "0", 10);
export const BLKIO_READ_IOPS = parseInt(process.env.BLKIO_READ_IOPS || "0", 10);
export const BLKIO_WRITE_IOPS = parseInt(process.env.BLKIO_WRITE_IOPS || "0", 10);

export const MINIMAL_RESOURCE_MODE = (process.env.MINIMAL_RESOURCE_MODE || "0") === "1";
if (MINIMAL_RESOURCE_MODE) {
  SANDBOX_MEMORY = "128m";
  SANDBOX_CPUS = "0.05";
  READONLY_ROOT = false;
}

export const UID = process.env.SANDBOX_USER_UID || "";
export const GID = process.env.SANDBOX_USER_GID || "";
export const DEBUG_SANDBOX = process.env.DEBUG_SANDBOX === "1";

export const USE_HOST_WORKSPACE = (process.env.USE_HOST_WORKSPACE || "false") === "true";
export const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";

export const ENABLE_APT_CAPS = (process.env.ENABLE_APT_CAPS || "1") === "1";

export const SANDBOX_TMPFS = process.env.SANDBOX_TMPFS || "";
