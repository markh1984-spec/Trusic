import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth";
import { users } from "../src/db/schema";
import { setDemoPassword } from "../src/demo";
import { call, createTestApp, type TestApp } from "./helpers";

// The public demo: sign-ups closed, demo accounts with the site's own password.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ env: { REGISTRATION: "closed" } });
});
afterAll(async () => {
  await t?.close();
});

const login = (email: string, password: string) =>
  call<{ token: string }>(t, "POST", "/api/auth/login", undefined, { email, password });

describe("public demo", () => {
  it("refuses sign-ups when registration is closed", async () => {
    const res = await call<{ error: string }>(t, "POST", "/api/auth/register", undefined, {
      email: "someone@trusic.test",
      password: "correct horse battery",
      displayName: "Someone",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Sign-ups aren't open yet.");
    // Browsing still works.
    expect((await call(t, "GET", "/api/tracks")).status).toBe(200);
  });

  it("switches the demo accounts from the default password to the site's own", async () => {
    const passwordHash = await hashPassword("trusic-demo");
    await t.database.db.insert(users).values([
      { email: "listener@trusic.local", displayName: "Listener", passwordHash },
      { email: "admin@trusic.local", displayName: "Admin", passwordHash },
      { email: "real@example.com", displayName: "Not a demo account", passwordHash },
    ]);
    const before = await login("listener@trusic.local", "trusic-demo");
    expect(before.status).toBe(200);

    expect(await setDemoPassword(t.database.db, "the-site-password")).toBe(true);
    expect((await login("listener@trusic.local", "trusic-demo")).status).toBe(401);
    expect((await login("admin@trusic.local", "the-site-password")).status).toBe(200);
    // Old sessions are signed out, and other accounts are left alone.
    expect((await call(t, "GET", "/api/me", before.body.token)).status).toBe(401);
    expect((await login("real@example.com", "trusic-demo")).status).toBe(200);

    // Restarting with the same password changes nothing, so nobody is signed out.
    const session = await login("listener@trusic.local", "the-site-password");
    expect(await setDemoPassword(t.database.db, "the-site-password")).toBe(false);
    expect((await call(t, "GET", "/api/me", session.body.token)).status).toBe(200);
  });
});
