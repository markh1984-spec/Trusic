import { describe, expect, it } from "vitest";
import { chooseSite, shareContent, shareUrl, type ShareTarget } from "./share";

const track: ShareTarget = { kind: "track", key: "11111111-2222-4333-8444-555555555555", title: "Chalk Paths · Pines" };

describe("share links", () => {
  it("link to the website's own pages, as the website's Share does", () => {
    expect(shareUrl("https://trusic.example", track)).toBe(
      "https://trusic.example/track/11111111-2222-4333-8444-555555555555",
    );
    expect(shareUrl("https://trusic.example", { kind: "artist", key: "the hollow pines", title: "Pines" })).toBe(
      "https://trusic.example/artist/the%20hollow%20pines",
    );
  });

  it("use the site set in the app, then the server's public address, then the API's", () => {
    const fallback = "http://192.168.1.20:3001";
    expect(chooseSite({ configured: "https://trusic.example/", reported: "https://other.example", fallback })).toBe(
      "https://trusic.example",
    );
    expect(chooseSite({ configured: null, reported: "https://trusic.onrender.com", fallback })).toBe(
      "https://trusic.onrender.com",
    );
    expect(chooseSite({ configured: null, reported: null, fallback })).toBe(fallback);
  });

  it("put the link where each phone's share sheet looks for it", () => {
    const url = "https://trusic.example/track/1";
    expect(shareContent("ios", track, url)).toEqual({ title: track.title, url });
    expect(shareContent("android", track, url)).toEqual({ title: track.title, message: url });
    expect(shareContent("web", track, url)).toEqual({ title: track.title, url });
  });
});
