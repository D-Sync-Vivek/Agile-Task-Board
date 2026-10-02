import type { RequestHandler } from "express";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie auth: browsers always send an Origin header on cross-site state-changing
 * requests, so if one is present and isn't our frontend, refuse. Requests without Origin
 * (curl, Postman, server-to-server) can't be forged by a victim's browser, so they pass.
 */
export const originGuard: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  if (!SAFE_METHODS.has(req.method) && origin && origin !== env.CLIENT_ORIGIN) {
    throw new AppError(403, "FORBIDDEN_ORIGIN", "Request origin is not allowed");
  }
  next();
};
