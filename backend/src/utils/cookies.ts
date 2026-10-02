import type { CookieOptions, Response } from "express";
import { env } from "../config/env";

export const AUTH_COOKIE_NAME = "taskboard_token";

const baseOptions: CookieOptions = {
  httpOnly: true, // not readable from JavaScript -> XSS can't steal the session token
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: "/",
};

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...baseOptions,
    maxAge: env.JWT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  // Attributes must match the ones used when setting the cookie or the browser keeps it.
  res.clearCookie(AUTH_COOKIE_NAME, baseOptions);
}
