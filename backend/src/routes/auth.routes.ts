import { Router } from "express";
import type { RequestHandler } from "express";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/requireAuth";
import { validateBody } from "../middleware/validate";
import { loginSchema, registerSchema } from "../validators/auth.validator";

export function createAuthRouter(credentialLimiter: RequestHandler): Router {
  const router = Router();

  router.post("/register", credentialLimiter, validateBody(registerSchema), authController.register);
  router.post("/login", credentialLimiter, validateBody(loginSchema), authController.login);
  router.post("/logout", authController.logout);
  router.get("/me", requireAuth, authController.me);

  return router;
}
