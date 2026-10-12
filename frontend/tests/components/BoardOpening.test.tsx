// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useRealtimeStore } from "@/store/useRealtimeStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { fake } from "../helpers/fakeSocket";
import { deferred, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";
import { nav, resetNav } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

/**
 * Opening a board, step by step (Phase 15):
 *   1 verify the session -> 2 fetch the board -> 3 render columns/tasks -> 4 fill the store
 *   -> 5 connect -> 6 join the room -> 7 listen.  And on leaving: stop listening, close, leave no trace.
 */
const NOW = "2026-10-04T10:00:00.000Z";
const ME = { id: "u1", name: "Vivek Kumar", email: "u1@example.com", avatar: null, createdAt: NOW };
const boardOf = (id = "b1", title = "Authentication") => makeBoard({ id, columns: [makeColumn("c1", "Todo", 0)], tasks: [makeTask(`t-${id}`, "c1", title, 0)] });

beforeEach(() => {
  resetApiMock();
  resetNav();
  nav.params = { boardId: "b1" };
  nav.pathname = "/boards/b1";
  useBoardStore.getState().reset();
  useTaskPanelStore.getState().close();
  useRealtimeStore.setState({ status: "idle" });
  useAuthStore.setState({ status: "authenticated", user: ME });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  api.comments.list.mockResolvedValue({ comments: [] });
});

describe("order of events when a board is opened", () => {
  it("1: nothing is fetched and no socket is opened until the session is confirmed", async () => {
    useAuthStore.setState({ status: "unknown", user: null });
    const session = deferred<{ user: typeof ME }>();
    api.auth.me.mockReturnValue(session.promise);
    api.boards.get.mockResolvedValue({ board: boardOf() });

    render(<BoardPage />);
    await act(async () => {});
    expect(api.auth.me).toHaveBeenCalledTimes(1); // asking who we are comes first
    expect(api.boards.get).not.toHaveBeenCalled();
    expect(fake.all).toHaveLength(0);

    await act(async () => {
      session.resolve({ user: ME });
    });
    expect(await screen.findByText("Authentication")).toBeInTheDocument(); // 2-4: fetched, rendered, in the store
    expect(api.boards.get).toHaveBeenCalled();
    expect(fake.all).toHaveLength(1); // 5: connected only now
  });

  it("an anonymous visitor triggers neither a board fetch nor a socket", async () => {
    useAuthStore.setState({ status: "anonymous", user: null });
    render(<BoardPage />);
    await act(async () => {});
    expect(api.boards.get).not.toHaveBeenCalled();
    expect(fake.all).toHaveLength(0);
  });

  it("5-7: the connection joins this board's room and listens, once", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    render(<BoardPage />);
    await screen.findByText("Authentication");
    await act(async () => {
      await fake.current.simulateConnect();
    });
    expect(fake.current.sent).toEqual([{ event: "board:join", payload: { boardId: "b1" } }]);
    expect(useRealtimeStore.getState().status).toBe("live");
  });

  it("a live event that arrives before the board has loaded is ignored safely", async () => {
    const loading = deferred<{ board: ReturnType<typeof boardOf> }>();
    api.boards.get.mockReturnValue(loading.promise);
    render(<BoardPage />);
    await act(async () => {});
    expect(() => fake.current.serverEmit("task:created", { task: makeTask("tx", "c1", "early", 0), actorId: "u2" })).not.toThrow();
    expect(useBoardStore.getState().tasks).toEqual([]);

    await act(async () => {
      loading.resolve({ board: boardOf() });
    });
    expect(await screen.findByText("Authentication")).toBeInTheDocument();
  });

  it("is measured: opening a board reads it twice (the page load, plus one re-read after joining so nothing made in between is missed)", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    render(<BoardPage />);
    await screen.findByText("Authentication");
    await act(async () => {
      await fake.current.simulateConnect();
    });
    expect(api.boards.get).toHaveBeenCalledTimes(2);
  });
});

describe("React StrictMode (what `next dev` does): effects run, clean up, and run again", () => {
  it("leaves exactly ONE live connection with ONE set of handlers", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    render(
      <StrictMode>
        <BoardPage />
      </StrictMode>
    );
    await screen.findByText("Authentication");
    const open = fake.all.filter((s) => !s.closed);
    expect(open).toHaveLength(1);
    expect(fake.all.filter((s) => s.closed).every((s) => s.listenerCount() === 0)).toBe(true); // the discarded one left nothing behind

    await act(async () => {
      await open[0].simulateConnect();
    });
    expect(open[0].sent.filter((m) => m.event === "board:join")).toHaveLength(1);

    // One handler per event: a pushed task appears exactly once.
    act(() => open[0].serverEmit("task:created", { task: makeTask("t2", "c1", "Pushed", 1), actorId: "u2" }));
    expect(useBoardStore.getState().tasks.filter((t) => t.title === "Pushed")).toHaveLength(1);
  });
});

describe("leaving the board leaves nothing running", () => {
  it("a join answer that arrives AFTER the user left does nothing", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    const view = render(<BoardPage />);
    await screen.findByText("Authentication");
    const socket = fake.current;
    socket.holdJoins = true;
    await act(async () => {
      await socket.simulateConnect();
    });
    const loadsBefore = api.boards.get.mock.calls.length;

    view.unmount();
    await act(async () => {
      socket.answerJoin({ ok: true }); // the server answers late, to a connection nobody owns any more
    });
    expect(api.boards.get).toHaveBeenCalledTimes(loadsBefore); // no re-read for a board that is no longer open
    expect(useRealtimeStore.getState().status).toBe("idle"); // and no status written by a dead connection
  });

  it("a join that times out after the user left does not resurrect the connection", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    const view = render(<BoardPage />);
    await screen.findByText("Authentication");
    const socket = fake.current;
    socket.holdJoins = true;
    await act(async () => {
      await socket.simulateConnect();
    });

    view.unmount();
    await act(async () => {
      socket.failJoin();
    });
    expect(socket.connectCalls).toBe(0); // it must not reconnect a socket that was closed on purpose
    expect(useRealtimeStore.getState().status).toBe("idle");
  });

  it("a stale join answer for the OLD board cannot disturb the NEW board being shown", async () => {
    api.boards.get.mockImplementation(async (id: string) => ({ board: id === "b2" ? boardOf("b2", "Second board task") : boardOf("b1") }));
    const view = render(<BoardPage />);
    await screen.findByText("Authentication");
    const first = fake.current;
    first.holdJoins = true;
    await act(async () => {
      await first.simulateConnect();
    });

    nav.params = { boardId: "b2" }; // the user opens another board
    view.rerender(<BoardPage />);
    await screen.findByText("Second board task");

    await act(async () => {
      first.answerJoin({ ok: true }); // late answer for board b1
    });
    await waitFor(() => expect(useBoardStore.getState().board?.id).toBe("b2"));
    expect(screen.getByText("Second board task")).toBeInTheDocument();
    expect(api.boards.get.mock.calls.map((c) => c[0])).not.toContain(undefined);
  });
});
