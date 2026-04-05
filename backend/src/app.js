import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { coursesRouter } from "./routes/courses.routes.js";
import { workbooksRouter } from "./routes/workbooks.routes.js";
import { translateRouter } from "./routes/translate.routes.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  if (config.isProd) {
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" },
      }),
    );
  }

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: config.jsonLimit }));

  app.get("/health", (req, res) => {
    res.json({ ok: true, env: config.nodeEnv });
  });

  app.use("/api/courses", coursesRouter);
  app.use("/api/workbooks", workbooksRouter);
  app.use("/api/translate", translateRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
