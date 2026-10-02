import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { AUTH_COOKIE_NAME } from "../src/utils/cookies";

const app = createApp();

const validUser = { name: "Vivek Kumar", email: "vivek@example.com", password: "password123" };

beforeEach(async () => {
  // CASCADE so later phases' tables that reference users are cleared too.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

function authCookie(res: request.Response): string | undefined {
  const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
}

describe("POST /api/auth/register", () => {
  it("creates a user, returns it without secrets and sets an HTTP-only cookie", async () => {
    const res = await request(app).post("/api/auth/register").send(validUser);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ name: "Vivek Kumar", email: "vivek@example.com" });
    expect(res.body.data.user.id).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password/i);

    const cookie = authCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("stores a bcrypt hash, never the plaintext password", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: validUser.email } });

    expect(stored.passwordHash).not.toBe(validUser.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("normalises email (trim + lowercase) so login is case-insensitive", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validUser, email: "  Vivek@Example.COM " });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("vivek@example.com");

    const login = await request(app).post("/api/auth/login").send({ email: "VIVEK@example.com", password: validUser.password });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const res = await request(app).post("/api/auth/register").send({ ...validUser, name: "Someone Else" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: { code: "EMAIL_ALREADY_EXISTS", message: "An account with this email already exists" },
    });
  });

  it("treats emails differing only by case as duplicates", async () => {
    await request(app).post("/api/auth/register").send(validUser);
    const res = await request(app).post("/api/auth/register").send({ ...validUser, email: "VIVEK@EXAMPLE.COM" });
    expect(res.status).toBe(409);
  });

  it("allows only one winner when the same email registers concurrently", async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => request(app).post("/api/auth/register").send(validUser))
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(await prisma.user.count()).toBe(1);
  });

  it("rejects a too-short password with 422 and field details", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...validUser, password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: "password" })]);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a password longer than bcrypt's 72-byte limit", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...validUser, password: "a".repeat(73) });
    expect(res.status).toBe(422);
  });

  it("rejects invalid email and missing name", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "not-an-email", password: "password123" });

    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(["email", "name"]);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app).post("/api/auth/register").set("Content-Type", "application/json").send("{ nope");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("ignores unexpected fields instead of persisting them", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...validUser, id: "attacker-chosen-id", avatar: "x" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.id).not.toBe("attacker-chosen-id");
    expect(res.body.data.user.avatar).toBeNull();
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(app).post("/api/auth/register").send(validUser);
  });

  it("logs in with valid credentials and sets the cookie", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    expect(authCookie(res)).toMatch(/HttpOnly/i);
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: validUser.email, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(authCookie(res)).toBeUndefined();
  });

  it("gives the identical response for an unknown email (no account enumeration)", async () => {
    const wrongPassword = await request(app).post("/api/auth/login").send({ email: validUser.email, password: "wrong-password" });
    const unknownEmail = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "whatever123" });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("rejects a missing password with 422", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: validUser.email });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/auth/me and session lifecycle", () => {
  it("rejects requests without a cookie with 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
  });

  it("rejects a garbage token", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", `${AUTH_COOKIE_NAME}=not.a.jwt`);
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = jwt.sign({}, "x".repeat(40), { subject: "some-user-id", expiresIn: 60 });
    const res = await request(app).get("/api/auth/me").set("Cookie", `${AUTH_COOKIE_NAME}=${forged}`);
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const reg = await request(app).post("/api/auth/register").send(validUser);
    const expired = jwt.sign({}, process.env.JWT_SECRET!, { subject: reg.body.data.user.id, expiresIn: -10 });
    const res = await request(app).get("/api/auth/me").set("Cookie", `${AUTH_COOKIE_NAME}=${expired}`);
    expect(res.status).toBe(401);
  });

  it("rejects a valid token whose user no longer exists", async () => {
    const reg = await request(app).post("/api/auth/register").send(validUser);
    const cookie = authCookie(reg)!.split(";")[0];
    await prisma.user.delete({ where: { id: reg.body.data.user.id } });

    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(401);
  });

  it("keeps the session across requests, then logout ends it", async () => {
    const agent = request.agent(app); // stores cookies like a browser
    await agent.post("/api/auth/register").send(validUser).expect(201);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(validUser.email);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);

    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(authCookie(logout)).toMatch(/Expires=Thu, 01 Jan 1970/i);

    await agent.get("/api/auth/me").expect(401);
  });

  it("can log back in after logout", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send(validUser).expect(201);
    await agent.post("/api/auth/logout").expect(200);
    await agent.post("/api/auth/login").send({ email: validUser.email, password: validUser.password }).expect(200);
    await agent.get("/api/auth/me").expect(200);
  });
});

describe("platform protections", () => {
  it("blocks state-changing requests from a foreign Origin (CSRF)", async () => {
    const res = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: validUser.email, password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows the configured frontend Origin and answers CORS with credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:3000")
      .send({ email: validUser.email, password: "x" });
    expect(res.status).toBe(401); // reached the handler (bad creds), not blocked
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rate-limits credential endpoints", async () => {
    const limitedApp = createApp({ authRateLimit: { limit: 3, windowMs: 60_000 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(limitedApp).post("/api/auth/login").send({ email: "a@example.com", password: "x" });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });

  it("returns a JSON 404 in the standard error format", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
