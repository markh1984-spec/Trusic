import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers";

// Apps on another origin (the phone app's browser build, the desktop app) call the API directly.
const origin = "http://localhost:8081";
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ env: { CORS_ORIGINS: origin } });
});
afterAll(async () => {
  await t?.close();
});

it("lets allowed origins unlike, unfollow and edit playlists", async () => {
  for (const method of ["DELETE", "PUT", "PATCH"]) {
    const res = await t.app.inject({
      method: "OPTIONS",
      url: "/api/me/likes/x",
      headers: { origin, "access-control-request-method": method },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain(method);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  }
});
