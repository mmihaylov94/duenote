import { config } from "../config.js";

/**
 * Express error handler (must be last, 4 arguments).
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = Number(err.statusCode || err.status) || 500;
  const message = err.message || "Internal Server Error";

  if (config.isProd) {
    console.error("[DueNote]", message);
  } else {
    console.error(err);
  }

  const body = { error: status === 500 ? "Internal Server Error" : message };
  if (!config.isProd && err && typeof err === "object") {
    if (Object.prototype.hasOwnProperty.call(err, "detail")) {
      body.detail = err.detail;
    }
  }
  res.status(status).json(body);
}
