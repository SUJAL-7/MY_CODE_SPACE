import { intEnv } from "./utils.js";

export const WORKSPACE_ROOT = "/workspace";
export const SCAN_MS = intEnv("SIMPLE_TREE_SCAN_MS", 2000);
export const WARMUP_SCANS = intEnv("SIMPLE_TREE_WARMUP_SCANS", 3);
export const WARMUP_INTERVAL = intEnv("SIMPLE_TREE_WARMUP_INTERVAL_MS", 250);
export const DEDUP_CHARS = process.env.SIMPLE_TREE_DEDUP_LEADING_CHARS || "";
export const DEBUG = process.env.DEBUG_SANDBOX === "1";

// Debounce settings for nudges
export const NUDGE_MIN_DELAY_MS = intEnv("SIMPLE_TREE_NUDGE_DELAY_MS", 120);
export const NUDGE_MAX_WAIT_MS = intEnv("SIMPLE_TREE_NUDGE_MAX_WAIT_MS", 600);
