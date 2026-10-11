// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { useToastStore } from "@/store/useToastStore";
import type { BoardMemberDto, BoardRole, Permission } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { ALL_PERMISSIONS, VIEWER_PERMISSIONS, apiError, deferred, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";
import { nav, resetNav } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const NOW = "2026-10-04T10:00:00.000Z";
const member = (id: string, userId: string, name: string, role: BoardRole): BoardMemberDto => ({ id, userId, role, createdAt: NOW, user: { id: userId, name, email: `${userId}@example.com`, avatar: null } });
const MEMBERS = [member("m1", "u1", "Vivek Kumar", "OWNER"), member("m2", "u2", "Adam Admin", "ADMIN"), member("m3", "u3", "Mia Member", "MEMBER"), member("m4", "u4", "Victor Viewer", "VIEWER")];
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !["board:update", "board:delete"].includes(p));
const meAs = (id: string) => useAuthStore.setState({ status: "authenticated", user: { id, name: "Me", email: `${id}@example.com`, avatar: null, createdAt: NOW } });

beforeEach(() => {
  resetApiMock();
  resetNav();
  nav.params = { boardId: "b1" };
  nav.pathname = "/boards/b1";
  useBoardStore.getState().reset();
  useTaskPanelStore.getState().close();
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

async function openSettings(role: BoardRole = "OWNER", permissions: Permission[] = ALL_PERMISSIONS, as = "u1") {
  meAs(as);
  api.boards.get.mockResolvedValue({
    board: makeBoard({ members: MEMBERS, myRole: role, myPermissions: permissions, columns: [makeColumn("c1", "Todo", 0)], tasks: [makeTask("t1", "c1", "Authentication", 0)] }),
  });
  render(<BoardPage />);
  await screen.findByText("Authentication");
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  return screen.findByRole("dialog", { name: "Board settings" });
}
const row = (panel: HTMLElement, name: string) => within(panel).getByText(new RegExp(`^${name}`)).closest("li") as HTMLElement;

describe("viewing the member list", () => {
  it("lists every member with email and role; a VIEWER gets no controls at all", async () => {
    const panel = await openSettings("VIEWER", VIEWER_PERMISSIONS, "u4");
    expect(within(panel).getByRole("heading", { name: "Members (4)" })).toBeInTheDocument();
    expect(within(panel).getByText("Mia Member")).toBeInTheDocument();
    expect(within(panel).getByText("u3@example.com")).toBeInTheDocument();
    expect(within(panel).getByText("Victor Viewer (you)")).toBeInTheDocument();
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(within(panel).getByText(/Only the owner and admins/)).toBeInTheDocument();
  });

  it("closes with × / Escape and returns focus to the Settings button", async () => {
    await openSettings();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
  });
});

describe("what each manager is offered", () => {
  it("OWNER: can change/remove ADMIN, MEMBER, VIEWER (ADMIN/MEMBER/VIEWER options); the owner row is a fixed badge", async () => {
    const panel = await openSettings();
    expect(within(row(panel, "Vivek Kumar")).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row(panel, "Vivek Kumar")).getByText("Owner")).toBeInTheDocument();
    const select = within(row(panel, "Adam Admin")).getByRole("combobox", { name: "Role of Adam Admin" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Admin", "Member", "Viewer"]);
    expect(within(row(panel, "Mia Member")).getByRole("button", { name: "Remove Mia Member" })).toBeInTheDocument();
  });

  it("ADMIN: can only manage MEMBER and VIEWER (options Member/Viewer); no controls for the owner, other admins or themselves", async () => {
    const panel = await openSettings("ADMIN", ADMIN_PERMISSIONS, "u2");
    expect(within(row(panel, "Vivek Kumar")).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row(panel, "Adam Admin")).queryByRole("combobox")).not.toBeInTheDocument();
    const select = within(row(panel, "Mia Member")).getByRole("combobox");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Member", "Viewer"]);
    const addRole = within(panel).getByLabelText("Role");
    expect(within(addRole).getAllByRole("option").map((o) => o.textContent)).toEqual(["Member", "Viewer"]);
  });
});

describe("changing a role", () => {
  it("sends the new role and shows the server's answer", async () => {
    const panel = await openSettings();
    api.members.updateRole.mockResolvedValue({ member: member("m3", "u3", "Mia Member", "ADMIN") });
    await userEvent.selectOptions(within(row(panel, "Mia Member")).getByRole("combobox"), "ADMIN");
    expect(api.members.updateRole).toHaveBeenCalledWith("b1", "m3", "ADMIN");
    expect(await within(row(panel, "Mia Member")).findByDisplayValue("Admin")).toBeInTheDocument();
  });

  it("shows the server's refusal next to the member and keeps the old role", async () => {
    const panel = await openSettings();
    api.members.updateRole.mockRejectedValue(apiError(403, "FORBIDDEN", "You can only manage members with a lower role than yours"));
    await userEvent.selectOptions(within(row(panel, "Mia Member")).getByRole("combobox"), "VIEWER");
    expect(await within(row(panel, "Mia Member")).findByRole("alert")).toHaveTextContent("lower role than yours");
    expect(within(row(panel, "Mia Member")).getByRole("combobox")).toHaveValue("MEMBER");
  });

  it("disables the control while the request is in flight", async () => {
    const panel = await openSettings();
    const d = deferred();
    api.members.updateRole.mockReturnValue(d.promise);
    await userEvent.selectOptions(within(row(panel, "Mia Member")).getByRole("combobox"), "VIEWER");
    expect(within(row(panel, "Mia Member")).getByRole("combobox")).toBeDisabled();
    d.resolve({ member: member("m3", "u3", "Mia Member", "VIEWER") });
    expect(await within(row(panel, "Mia Member")).findByDisplayValue("Viewer")).toBeEnabled();
  });
});

describe("removing a member", () => {
  it("asks for confirmation, and Cancel changes nothing", async () => {
    const panel = await openSettings();
    await userEvent.click(within(row(panel, "Mia Member")).getByRole("button", { name: "Remove Mia Member" }));
    expect(within(panel).getByRole("alertdialog")).toHaveTextContent("their tasks become unassigned");
    await userEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(within(panel).queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.members.remove).not.toHaveBeenCalled();
  });

  it("confirming removes them from the list", async () => {
    const panel = await openSettings();
    api.members.remove.mockResolvedValue({ unassignedTasks: 0 });
    await userEvent.click(within(row(panel, "Mia Member")).getByRole("button", { name: "Remove Mia Member" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Remove" }));
    expect(api.members.remove).toHaveBeenCalledWith("b1", "m3");
    expect(await within(panel).findByRole("heading", { name: "Members (3)" })).toBeInTheDocument();
    expect(within(panel).queryByText("Mia Member")).not.toBeInTheDocument();
  });

  it("a failed removal keeps the member and says why", async () => {
    const panel = await openSettings();
    api.members.remove.mockRejectedValue(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await userEvent.click(within(row(panel, "Mia Member")).getByRole("button", { name: "Remove Mia Member" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Remove" }));
    expect(await within(row(panel, "Mia Member")).findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(within(panel).getByRole("heading", { name: "Members (4)" })).toBeInTheDocument();
  });
});

describe("adding a member", () => {
  it("adds by email with the chosen role, then clears the form and confirms", async () => {
    const panel = await openSettings();
    api.members.add.mockResolvedValue({ member: member("m5", "u5", "Rahul", "VIEWER") });
    await userEvent.type(within(panel).getByLabelText("Email of a registered user"), "  rahul@example.com ");
    await userEvent.selectOptions(within(panel).getByLabelText("Role"), "VIEWER");
    await userEvent.click(within(panel).getByRole("button", { name: "Add member" }));

    expect(api.members.add).toHaveBeenCalledWith("b1", { email: "rahul@example.com", role: "VIEWER" });
    expect(await within(panel).findByRole("heading", { name: "Members (5)" })).toBeInTheDocument();
    expect(within(panel).getByText("Rahul")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Email of a registered user")).toHaveValue("");
    expect(within(panel).getByRole("status")).toHaveTextContent("Added rahul@example.com");
  });

  it("defaults the role to Member, and the button is disabled until there is an email", async () => {
    const panel = await openSettings();
    expect(within(panel).getByLabelText("Role")).toHaveValue("MEMBER");
    expect(within(panel).getByRole("button", { name: "Add member" })).toBeDisabled();
  });

  it("shows 'no such user' and 'already a member' next to the email field", async () => {
    const panel = await openSettings();
    const email = within(panel).getByLabelText("Email of a registered user");
    api.members.add.mockRejectedValueOnce(apiError(404, "USER_NOT_FOUND", "No user with that email address. They need to register first."));
    await userEvent.type(email, "ghost@example.com");
    await userEvent.click(within(panel).getByRole("button", { name: "Add member" }));
    expect(await within(panel).findByText(/They need to register first/)).toBeInTheDocument();
    expect(email).toHaveValue("ghost@example.com"); // kept so it can be corrected

    api.members.add.mockRejectedValueOnce(apiError(409, "ALREADY_MEMBER", "That user is already a member of this board"));
    await userEvent.click(within(panel).getByRole("button", { name: "Add member" }));
    expect(await within(panel).findByText("That user is already a member of this board")).toBeInTheDocument();
  });

  it("shows server-side validation of the email", async () => {
    const panel = await openSettings();
    api.members.add.mockRejectedValue(apiError(422, "VALIDATION_ERROR", "Invalid request data"));
    await userEvent.type(within(panel).getByLabelText("Email of a registered user"), "nope");
    await userEvent.click(within(panel).getByRole("button", { name: "Add member" }));
    expect(await within(panel).findByRole("alert")).toBeInTheDocument();
  });
});
