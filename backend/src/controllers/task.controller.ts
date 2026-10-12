import type { Request, RequestHandler } from "express";
import * as taskService from "../services/task.service";
import { broadcast, flushActivity } from "../sockets/realtime";
import { AppError } from "../utils/AppError";
import type { AssignTaskInput, CreateTaskInput, MoveTaskInput, UpdateTaskInput } from "../validators/task.validator";

// All handlers run behind requireAuth + requireBoardPermission (sets req.boardMembership).
function boardIdOf(req: Request): string {
  if (!req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.boardMembership.boardId;
}

function userIdOf(req: Request): string {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.user.id;
}

const taskIdOf = (req: Request) => String(req.params.taskId);

export const list: RequestHandler = async (req, res) => {
  const tasks = await taskService.listTasks(boardIdOf(req));
  res.status(200).json({ success: true, data: { tasks } });
};

export const create: RequestHandler = async (req, res) => {
  const task = await taskService.createTask(boardIdOf(req), userIdOf(req), req.body as CreateTaskInput);
  broadcast(req, boardIdOf(req), "task:created", { task, actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(201).json({ success: true, data: { task } });
};

export const get: RequestHandler = async (req, res) => {
  const task = await taskService.getTask(taskIdOf(req));
  res.status(200).json({ success: true, data: { task } });
};

export const update: RequestHandler = async (req, res) => {
  const task = await taskService.updateTask(boardIdOf(req), taskIdOf(req), userIdOf(req), req.body as UpdateTaskInput);
  broadcast(req, boardIdOf(req), "task:updated", { task, actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(200).json({ success: true, data: { task } });
};

export const remove: RequestHandler = async (req, res) => {
  await taskService.deleteTask(boardIdOf(req), taskIdOf(req), userIdOf(req));
  broadcast(req, boardIdOf(req), "task:deleted", { taskId: taskIdOf(req), actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(200).json({ success: true, data: null });
};

export const move: RequestHandler = async (req, res) => {
  const result = await taskService.moveTask(boardIdOf(req), taskIdOf(req), userIdOf(req), req.body as MoveTaskInput);
  broadcast(req, boardIdOf(req), "task:moved", { task: result.task, columns: result.columns, actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(200).json({ success: true, data: result });
};

export const assign: RequestHandler = async (req, res) => {
  const task = await taskService.assignTask(boardIdOf(req), taskIdOf(req), userIdOf(req), req.body as AssignTaskInput);
  broadcast(req, boardIdOf(req), "task:updated", { task, actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(200).json({ success: true, data: { task } });
};
