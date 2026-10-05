import { createApiClient } from "./client";
import { createApi } from "./endpoints";

// NEXT_PUBLIC_* is inlined into the browser bundle: it must only ever hold the (public) API address.
const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = createApi(createApiClient({ baseUrl }));

export { ApiError, createApiClient } from "./client";
export type { ApiClient } from "./client";
export { createApi } from "./endpoints";
export type { Api } from "./endpoints";
