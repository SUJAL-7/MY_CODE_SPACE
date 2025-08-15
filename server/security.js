import crypto from "crypto";
import Joi from "joi";

const SESSION_TOKEN_VERSION = "v1";

// Only username needed now.
export const initSchema = Joi.object({
  username: Joi.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/).required()
}).unknown(true); // tolerate legacy fields silently

export const inputSchema = Joi.object({
  data: Joi.string().max(8192).required(),
  sessionId: Joi.string().min(5).max(100).required(),
  token: Joi.string().min(10).max(200).required()
});

export const resizeSchema = Joi.object({
  cols: Joi.number().integer().min(10).max(1000).required(),
  rows: Joi.number().integer().min(5).max(500).required(),
  sessionId: Joi.string().min(5).max(100).required(),
  token: Joi.string().min(10).max(200).required()
});

export const killSchema = Joi.object({
  sessionId: Joi.string().min(5).max(100).required(),
  token: Joi.string().min(10).max(200).required()
});

export const statsSubscribeSchema = Joi.object({
  sessionId: Joi.string().min(5).max(100).required(),
  token: Joi.string().min(10).max(200).required()
});

export const statsUnsubscribeSchema = Joi.object({
  sessionId: Joi.string().min(5).max(100).required(),
  token: Joi.string().min(10).max(200).required()
});

export function deriveSessionToken(serverSecret, sessionId, socketId) {
  const h = crypto.createHmac("sha256", serverSecret);
  h.update(SESSION_TOKEN_VERSION);
  h.update("|");
  h.update(sessionId);
  h.update("|");
  h.update(socketId);
  return `${SESSION_TOKEN_VERSION}.${h.digest("hex")}`;
}

export function verifySessionToken(serverSecret, token, sessionId, socketId) {
  if (!token) return false;
  const [ver, digest] = token.split(".");
  if (ver !== SESSION_TOKEN_VERSION || !digest) return false;
  const expected = deriveSessionToken(serverSecret, sessionId, socketId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(`${ver}.${digest}`));
}

export function sanitizeUsername(name = "user") {
  return (name || "user").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 32) || "user";
}

export function validateRequest(schema, payload) {
  const { error, value } = schema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) {
    const msg = error.details.map(d => d.message).join("; ");
    const err = new Error(msg);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return value;
}