import type { JoinAck } from "@/types/realtime";

type Listener = (...args: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any -- a fake: events are untyped on purpose

/**
 * A stand-in for the Socket.IO client, installed for EVERY unit test (tests/setup.ts), so no test ever opens a real
 * connection. Tests drive it from the "server" side: `fake.current.serverEmit("task:created", {...})`.
 */
export class FakeSocket {
  id: string | undefined = "fake-socket-1";
  connected = false;
  closed = false;
  connectCalls = 0;
  /** Answer to board:join. Set `joinHangs` to simulate a server that never answers. */
  joinAck: JoinAck = { ok: true };
  joinHangs = false;
  /** When true, board:join answers are held until `answerJoin` / `failJoin` is called (to test late answers). */
  holdJoins = false;
  private heldJoins: { resolve: (ack: JoinAck) => void; reject: (error: Error) => void }[] = [];
  sent: { event: string; payload: unknown }[] = [];
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  removeAllListeners() {
    this.listeners.clear();
    return this;
  }
  listenerCount(event?: string) {
    return event ? (this.listeners.get(event)?.size ?? 0) : [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }

  connect() {
    this.connectCalls++;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.closed = true;
    return this;
  }
  timeout() {
    return { emitWithAck: (event: string, payload: unknown) => this.emitWithAck(event, payload) };
  }
  emitWithAck(event: string, payload: unknown): Promise<JoinAck> {
    this.sent.push({ event, payload });
    if (this.joinHangs) return Promise.reject(new Error("operation has timed out"));
    if (this.holdJoins) return new Promise((resolve, reject) => this.heldJoins.push({ resolve, reject }));
    return Promise.resolve(this.joinAck);
  }
  /** Delivers the server's answer to every held join. */
  answerJoin(ack: JoinAck = this.joinAck) {
    for (const held of this.heldJoins.splice(0)) held.resolve(ack);
  }
  /** The ack never arrives: the client-side timeout fires. */
  failJoin() {
    for (const held of this.heldJoins.splice(0)) held.reject(new Error("operation has timed out"));
  }

  // ---- test controls
  /** Delivers an event as if the server had sent it. */
  serverEmit(event: string, payload?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }
  /** The transport connected (first time or after a drop). Resolves once the join handshake has finished. */
  async simulateConnect() {
    this.connected = true;
    this.serverEmit("connect");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  simulateDisconnect(reason = "transport close") {
    this.connected = false;
    this.serverEmit("disconnect", reason);
  }
  simulateConnectError(message: string) {
    this.serverEmit("connect_error", new Error(message));
  }
}

const sockets: FakeSocket[] = [];

export const fake = {
  get current(): FakeSocket {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error("No socket was opened");
    return socket;
  },
  get all() {
    return sockets;
  },
  reset() {
    sockets.length = 0;
  },
};

// ---- the module surface that lib/realtime/socket.ts exposes
export const openSocket = () => {
  const socket = new FakeSocket();
  sockets.push(socket);
  return socket;
};
export const closeSocket = () => {
  const socket = sockets[sockets.length - 1];
  if (socket && !socket.closed) {
    socket.removeAllListeners();
    socket.disconnect();
  }
};
export const getSocketId = () => {
  const socket = sockets[sockets.length - 1];
  return socket && !socket.closed ? socket.id : undefined;
};
