import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { coursesRouter } from "./routes/courses.routes.js";
import { workbooksRouter } from "./routes/workbooks.routes.js";
import { translateRouter } from "./routes/translate.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { mediaRouter } from "./routes/media.routes.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const PgSessionStore = connectPgSimple(session);

export function createApp() {
  const app = express();

  if (config.isProd) {
    app.set("trust proxy", 1);
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" },
      }),
    );
  }

  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: config.jsonLimit }));

  app.use(
    session({
      name: config.sessionCookieName,
      store: new PgSessionStore({
        pool,
        createTableIfMissing: true,
        tableName: "session",
      }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(passport.initialize());

  app.get("/health", (req, res) => {
    res.json({ ok: true, env: config.nodeEnv });
  });

  app.use("/api/auth", authRouter);
  /** Alias for OAuth: same routes as `/api/auth/*` (e.g. `/auth/google` when `GOOGLE_CALLBACK_URL` omits `/api`). */
  app.use("/auth", authRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/courses", coursesRouter);
  app.use("/api/workbooks", workbooksRouter);
  app.use("/api/translate", translateRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
