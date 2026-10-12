// NEXT_PUBLIC_* is inlined into the browser bundle: it must only ever hold the (public) API address.
// The REST client and the Socket.IO client talk to the same server, so they share this one setting.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
