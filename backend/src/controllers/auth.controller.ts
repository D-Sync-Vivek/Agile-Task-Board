import type { RequestHandler } from "express";
import * as authService from "../services/auth.service";
import { clearAuthCookie, setAuthCookie } from "../utils/cookies";
import type { LoginInput, RegisterInput } from "../validators/auth.validator";

// Controllers translate HTTP <-> service calls. No business rules and no database access here.

export const register: RequestHandler = async (req, res) => {
  const user = await authService.registerUser(req.body as RegisterInput);
  setAuthCookie(res, authService.signAuthToken(user.id));
  res.status(201).json({ success: true, data: { user } });
};

export const login: RequestHandler = async (req, res) => {
  const user = await authService.authenticateUser(req.body as LoginInput);
  setAuthCookie(res, authService.signAuthToken(user.id));
  res.status(200).json({ success: true, data: { user } });
};

export const logout: RequestHandler = (_req, res) => {
  clearAuthCookie(res);
  res.status(200).json({ success: true, data: null });
};

export const me: RequestHandler = (req, res) => {
  res.status(200).json({ success: true, data: { user: req.user } });
};
