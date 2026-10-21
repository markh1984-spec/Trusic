import { ApiError, type PlayBatchResult, type PlayReport } from "@trusic/client";
import { describe, expect, it } from "vitest";
import { newPlayId, PlayOutbox, type OutboxStorage } from "./outbox";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(initial: PlayReport[] | null = null) {
  const store = { saved: initial, saves: 0 };
  const storage: OutboxStorage = {
    load: async () => store.saved,
    save: async (plays) => {
      store.saved = plays;
      store.saves += 1;
    },
  };
  return { store, storage };
}

/** A pretend server that remembers what it was sent and can be switched off. */
function fakeServer() {
  const server = {
    online: true,
    batches: [] as PlayReport[][],
    send: async (plays: PlayReport[]): Promise<PlayBatchResult> => {
      if (!server.online) throw new TypeError("Network request failed");
      server.batches.push(plays.map((p) => ({ ...p })));
      return { results: plays.map((p) => ({ id: p.id, status: "counted" as const })) };
    },
  };
  return server;
}

const listen = (overrides: Partial<PlayReport> = {}): PlayReport => ({
  id: newPlayId(),
  trackId: "track-1",
  playedAt: new Date(NOW - 60_000).toISOString(),
  msPlayed: 45_000,
  ...overrides,
});

describe("PlayOutbox", () => {
  it("keeps plays made offline and sends them once back online", async () => {
    const { store, storage } = memoryStorage();
    const server = fakeServer();
    server.online = false;
    const outbox = new PlayOutbox(storage, server.send, { now: () => NOW });
    const a = listen();
    const b = listen({ trackId: "track-2" });
    await outbox.add(a);
    await outbox.add(b);

    expect(await outbox.flush()).toBe(false);
    expect(outbox.size).toBe(2);
    expect(store.saved?.map((p) => p.id)).toEqual([a.id, b.id]);

    server.online = true;
    expect(await outbox.flush()).toBe(true);
    expect(server.batches).toEqual([[a, b]]);
    expect(outbox.size).toBe(0);
    expect(store.saved).toEqual([]);
  });

  it("survives the app closing: a new outbox picks up what was saved", async () => {
    const saved = [listen(), listen()];
    const { storage } = memoryStorage(saved);
    const server = fakeServer();
    const outbox = new PlayOutbox(storage, server.send, { now: () => NOW });
    await outbox.flush();
    expect(server.batches.flat().map((p) => p.id)).toEqual(saved.map((p) => p.id));
  });

  it("keeps one entry per listen, with the longest time reported", async () => {
    const { storage } = memoryStorage();
    const server = fakeServer();
    server.online = false;
    const outbox = new PlayOutbox(storage, server.send, { now: () => NOW });
    const early = listen({ msPlayed: 20_000 });
    await outbox.add(early);
    await outbox.add({ ...early, msPlayed: 180_000 });
    await outbox.add({ ...early, msPlayed: 5_000 });
    expect(outbox.pending).toEqual([{ ...early, msPlayed: 180_000 }]);
  });

  it("sends a listen again if it grew while the first report was on its way", async () => {
    const { storage } = memoryStorage();
    const sent: PlayReport[][] = [];
    let outbox: PlayOutbox;
    const play = listen({ msPlayed: 20_000 });
    let first = true;
    outbox = new PlayOutbox(
      storage,
      async (plays) => {
        sent.push(plays.map((p) => ({ ...p })));
        if (first) {
          first = false;
          await outbox.add({ ...play, msPlayed: 200_000 });
        }
        return { results: plays.map((p) => ({ id: p.id, status: "counted" as const })) };
      },
      { now: () => NOW },
    );
    await outbox.add(play);
    expect(await outbox.flush()).toBe(true);
    expect(sent.map((batch) => batch.map((p) => p.msPlayed))).toEqual([[20_000], [200_000]]);
    expect(outbox.size).toBe(0);
  });

  it("drops plays turned down by the server, and stops keeping ones over 30 days old", async () => {
    const { storage } = memoryStorage();
    const old = listen({ playedAt: new Date(NOW - 31 * DAY).toISOString() });
    const refused = listen();
    const outbox = new PlayOutbox(
      storage,
      async (plays) => ({
        results: plays.map((p) => ({ id: p.id, status: "rejected" as const, reason: "not_subscribed" as const })),
      }),
      { now: () => NOW },
    );
    await outbox.add(old);
    await outbox.add(refused);
    expect(await outbox.flush()).toBe(true);
    expect(outbox.size).toBe(0);
  });

  it("waits when the server is busy or the sign-in needs renewing, but gives up on a batch it can never accept", async () => {
    const { storage } = memoryStorage();
    let error: unknown = new ApiError(503, "Busy");
    const outbox = new PlayOutbox(
      storage,
      async () => {
        throw error;
      },
      { now: () => NOW },
    );
    await outbox.add(listen());
    expect(await outbox.flush()).toBe(false);
    error = new ApiError(401, "Please log in.");
    expect(await outbox.flush()).toBe(false);
    expect(outbox.size).toBe(1);
    error = new ApiError(400, "plays.0.id: Invalid UUID");
    expect(await outbox.flush()).toBe(true);
    expect(outbox.size).toBe(0);
  });

  it("sends big queues in batches", async () => {
    const { storage } = memoryStorage();
    const server = fakeServer();
    const outbox = new PlayOutbox(storage, server.send, { now: () => NOW });
    for (let i = 0; i < 250; i++) await outbox.add(listen());
    await outbox.flush();
    expect(server.batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it("makes up a valid UUID for each listen", () => {
    const ids = new Set(Array.from({ length: 100 }, newPlayId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
