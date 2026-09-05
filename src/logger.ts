import pino from "pino";
import type { Env } from "./env.js";

export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.x-api-key",
        "request.headers.authorization",
        "request.headers.x-api-key"
      ],
      censor: "[REDACTED]"
    }
  });
}

