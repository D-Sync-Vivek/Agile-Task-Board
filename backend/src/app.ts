import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { originGuard } from "./middleware/originGuard";
import { createAuthRateLimiter } from "./middleware/rateLimit";
import type { RateLimitOptions } from "./middleware/rateLimit";
import { createActivityRouter } from "./routes/activity.routes";
import { createAuthRouter } from "./routes/auth.routes";
import { createBoardRouter } from "./routes/board.routes";
import { createColumnRouter } from "./routes/column.routes";
import { createCommentRouter } from "./routes/comment.routes";
import { createTaskRouter } from "./routes/task.routes";

export interface AppOptions {
  authRateLimit?: RateLimitOptions;
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(originGuard);

  const authLimiter = createAuthRateLimiter(
    options.authRateLimit ?? { limit: env.AUTH_RATE_LIMIT_MAX, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 }
  );
  app.use("/api/auth", createAuthRouter(authLimiter));
  // Column, task and comment routes first: they match /api/boards/:id/columns..., so the board router never re-runs requireAuth for them.
  app.use("/api", createColumnRouter());
  app.use("/api", createTaskRouter());
  app.use("/api", createCommentRouter());
  app.use("/api", createActivityRouter());
  app.use("/api/boards", createBoardRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
