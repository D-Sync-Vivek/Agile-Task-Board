import { API_URL } from "@/lib/config";
import { getSocketId } from "@/lib/realtime/socket";
import { createApiClient } from "./client";
import { createApi } from "./endpoints";

export const api = createApi(createApiClient({ baseUrl: API_URL, getSocketId }));

export { ApiError, createApiClient } from "./client";
export type { ApiClient } from "./client";
export { createApi } from "./endpoints";
export type { Api } from "./endpoints";
