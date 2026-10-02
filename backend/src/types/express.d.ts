import type { PublicUser } from "../services/auth.service";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: PublicUser;
    }
  }
}

export {};
