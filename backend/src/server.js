import { createApp } from "./app.js";
import { initDatabase } from "./db/init.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";

try {
  await initDatabase();
} catch (err) {
  console.error("[DueNote] PostgreSQL connection / schema failed:", err.message);
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`DueNote API listening on port ${config.port} (${config.nodeEnv})`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${config.port} is already in use. Stop the other process or set PORT in .env and point the frontend VITE_API_URL at the same host/port.`,
    );
    process.exit(1);
  }
  throw err;
});

function shutdown(signal) {
  console.log(`[DueNote] ${signal}, shutting down…`);
  server.close(async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
