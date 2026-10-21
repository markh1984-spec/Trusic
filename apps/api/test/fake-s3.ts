import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseRange } from "../src/routes/listening";

/**
 * A tiny S3-compatible server for tests: path-style objects in memory, with Range, HEAD and DELETE. It checks that
 * each request is signed and that an upload's body matches the hash it was signed with. (The signature itself is
 * checked against AWS's published example in the unit tests, and against a real server by hand.)
 */
export interface FakeS3 {
  endpoint: string;
  objects: Map<string, { body: Buffer; contentType: string }>;
  requests: { method: string; path: string; range?: string }[];
  close(): Promise<void>;
}

export async function startFakeS3(options: { prefix?: string; bucket: string }): Promise<FakeS3> {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const requests: FakeS3["requests"] = [];
  const base = `${options.prefix ?? ""}/${options.bucket}/`;

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const path = decodeURIComponent(new URL(req.url!, "http://x").pathname);
    requests.push({ method: req.method!, path, range: req.headers.range });

    const fail = (status: number, code: string) => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(req.method === "HEAD" ? undefined : `<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
    };
    if (!String(req.headers.authorization).startsWith("AWS4-HMAC-SHA256 Credential=")) return fail(403, "AccessDenied");
    if (!path.startsWith(base)) return fail(404, "NoSuchBucket");
    const key = path.slice(base.length);

    if (req.method === "PUT") {
      const hash = createHash("sha256").update(body).digest("hex");
      if (req.headers["x-amz-content-sha256"] !== hash) return fail(400, "XAmzContentSHA256Mismatch");
      if (Number(req.headers["content-length"]) !== body.length) return fail(400, "IncompleteBody");
      objects.set(key, { body, contentType: String(req.headers["content-type"]) });
      res.writeHead(200, { etag: `"${hash}"` });
      return res.end();
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    const object = objects.get(key);
    if (!object) return fail(404, "NoSuchKey");
    if (req.method === "HEAD") {
      res.writeHead(200, { "content-length": object.body.length, "content-type": object.contentType });
      return res.end();
    }
    if (req.method === "GET") {
      const range = req.headers.range ? parseRange(req.headers.range, object.body.length) : null;
      if (req.headers.range && !range) return fail(416, "InvalidRange");
      const part = range ? object.body.subarray(range.start, range.end + 1) : object.body;
      res.writeHead(range ? 206 : 200, {
        "content-length": part.length,
        ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${object.body.length}` } : {}),
      });
      return res.end(part);
    }
    fail(405, "MethodNotAllowed");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}${options.prefix ?? ""}`,
    objects,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
