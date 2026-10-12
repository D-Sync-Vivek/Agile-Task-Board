import { beforeEach, describe, expect, it, vi } from "vitest";

// The real lib/realtime/socket.ts (the global setup replaces it with a fake), over a stubbed socket.io-client.
const made: { url: string; options: Record<string, unknown>; socket: ReturnType<typeof makeSocket> }[] = [];
const makeSocket = () => ({ id: "abc", removeAllListeners: vi.fn(), disconnect: vi.fn() });
vi.mock("socket.io-client", () => ({
  io: (url: string, options: Record<string, unknown>) => {
    const socket = makeSocket();
    made.push({ url, options, socket });
    return socket;
  },
}));

const real = () => vi.importActual<typeof import("@/lib/realtime/socket")>("@/lib/realtime/socket");

beforeEach(async () => {
  (await real()).closeSocket(); // the module keeps the current socket between tests
  made.length = 0;
});

describe("lib/realtime/socket", () => {
  it("connects with the session cookie (credentials) over WebSocket", async () => {
    const { openSocket } = await real();
    openSocket("http://api.test");
    expect(made[0].url).toBe("http://api.test");
    expect(made[0].options).toMatchObject({ withCredentials: true, transports: ["websocket"] });
  });

  it("exposes the socket's id only while one is open", async () => {
    const { openSocket, closeSocket, getSocketId } = await real();
    expect(getSocketId()).toBeUndefined();
    openSocket("http://api.test");
    expect(getSocketId()).toBe("abc");
    closeSocket();
    expect(getSocketId()).toBeUndefined();
  });

  it("closing removes all listeners and disconnects; opening again closes the previous connection first", async () => {
    const { openSocket, closeSocket } = await real();
    openSocket("http://api.test");
    openSocket("http://api.test");
    expect(made[0].socket.removeAllListeners).toHaveBeenCalled();
    expect(made[0].socket.disconnect).toHaveBeenCalled();
    closeSocket();
    expect(made[1].socket.disconnect).toHaveBeenCalled();
    closeSocket(); // closing twice is harmless
    expect(made[1].socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
