import type { BoardMembership } from "../services/authorization.service";
import type { PublicUser } from "../services/auth.service";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: PublicUser;
      /** Set by requireBoardPermission: the caller's role on the board being accessed. */
      boardMembership?: BoardMembership;
    }
  }
}

export {};
