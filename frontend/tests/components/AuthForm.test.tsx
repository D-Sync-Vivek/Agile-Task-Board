// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthForm from "@/components/auth/AuthForm";
import { useAuthStore } from "@/store/useAuthStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred } from "../helpers/fixtures";
import { resetNav, router } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const user = { id: "u1", name: "Vivek Kumar", email: "vivek@example.com", avatar: null, createdAt: "2026-10-04T00:00:00.000Z" };

beforeEach(() => {
  resetApiMock();
  resetNav();
  useAuthStore.setState({ status: "anonymous", user: null });
  window.history.pushState({}, "", "/login");
});

async function fillLogin(email = "vivek@example.com", password = "password123") {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText("Email"), email);
  await u.type(screen.getByLabelText("Password"), password);
  await u.click(screen.getByRole("button", { name: "Log in" }));
  return u;
}

describe("login", () => {
  it("submits the entered credentials, then goes to the home page", async () => {
    api.auth.login.mockResolvedValueOnce({ user });
    render(<AuthForm mode="login" />);
    await fillLogin();

    expect(api.auth.login).toHaveBeenCalledWith({ email: "vivek@example.com", password: "password123" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("returns to the page the user came from (?next=)", async () => {
    window.history.pushState({}, "", "/login?next=%2Fboards%2Fb1");
    api.auth.login.mockResolvedValueOnce({ user });
    render(<AuthForm mode="login" />);
    await fillLogin();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/boards/b1"));
  });

  it.each(["https://evil.com", "//evil.com", "/\\evil.com"])("refuses to redirect to an external ?next=%s", async (next) => {
    window.history.pushState({}, "", `/login?next=${encodeURIComponent(next)}`);
    api.auth.login.mockResolvedValueOnce({ user });
    render(<AuthForm mode="login" />);
    await fillLogin();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(router.replace).not.toHaveBeenCalledWith(next);
  });

  it("shows a pending state and prevents double submission", async () => {
    const d = deferred();
    api.auth.login.mockReturnValueOnce(d.promise);
    render(<AuthForm mode="login" />);
    await fillLogin();

    const button = screen.getByRole("button", { name: "Logging in…" });
    expect(button).toBeDisabled();
    d.reject(apiError(401, "INVALID_CREDENTIALS", "Invalid email or password"));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("shows the server's message for bad credentials in an alert, and does not navigate", async () => {
    api.auth.login.mockRejectedValueOnce(apiError(401, "INVALID_CREDENTIALS", "Invalid email or password"));
    render(<AuthForm mode="login" />);
    await fillLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows per-field validation messages from a 422", async () => {
    api.auth.login.mockRejectedValueOnce(
      new (await import("@/lib/api/client")).ApiError(422, "VALIDATION_ERROR", "Invalid request data", [{ field: "email", message: "Enter a valid email address" }])
    );
    render(<AuthForm mode="login" />);
    await fillLogin("not-an-email");
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // field error, not a general banner
  });

  it("explains a network failure", async () => {
    api.auth.login.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR", "Unable to reach the server. Check your connection and try again."));
    render(<AuthForm mode="login" />);
    await fillLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to reach the server/i);
  });

  it("sends an already signed-in visitor away from the login page", async () => {
    useAuthStore.setState({ status: "authenticated", user });
    render(<AuthForm mode="login" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("checks the session first when the status is still unknown", async () => {
    useAuthStore.setState({ status: "unknown", user: null });
    api.auth.me.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    render(<AuthForm mode="login" />);
    await waitFor(() => expect(api.auth.me).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("register", () => {
  it("has a name field and submits name, email and password", async () => {
    api.auth.register.mockResolvedValueOnce({ user });
    render(<AuthForm mode="register" />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Name"), "Vivek Kumar");
    await u.type(screen.getByLabelText("Email"), "vivek@example.com");
    await u.type(screen.getByLabelText("Password"), "password123");
    await u.click(screen.getByRole("button", { name: "Create account" }));

    expect(api.auth.register).toHaveBeenCalledWith({ name: "Vivek Kumar", email: "vivek@example.com", password: "password123" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("shows a duplicate-email error", async () => {
    api.auth.register.mockRejectedValueOnce(apiError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists"));
    render(<AuthForm mode="register" />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Name"), "V");
    await u.type(screen.getByLabelText("Email"), "vivek@example.com");
    await u.type(screen.getByLabelText("Password"), "password123");
    await u.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
  });

  it("links to the other form and keeps ?next=", () => {
    window.history.pushState({}, "", "/register?next=%2Fboards%2Fb1");
    render(<AuthForm mode="register" />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Fboards%2Fb1");
  });
});
