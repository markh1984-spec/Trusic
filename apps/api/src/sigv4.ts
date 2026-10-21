import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, which every S3-compatible store (Supabase Storage, Cloudflare R2, Backblaze B2, MinIO)
 * uses to check requests. Written out here rather than pulling in the AWS SDK, which is large and would cost memory
 * that free hosting doesn't have.
 */

export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export interface SigningKeys {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export interface RequestToSign {
  method: string;
  url: URL;
  /** Headers to sign, besides host and the x-amz ones added here. Names are matched case-insensitively. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or "UNSIGNED-PAYLOAD". */
  payloadHash?: string;
  date?: Date;
}

/** RFC 3986 encoding, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ is escaped. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

/** The headers to send with the request: the given ones, plus host, x-amz-date, x-amz-content-sha256 and authorization. */
export function signRequest(keys: SigningKeys, request: RequestToSign): Record<string, string> {
  const service = keys.service ?? "s3";
  const amzDate = (request.date ?? new Date())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = request.payloadHash ?? EMPTY_SHA256;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) headers[name.toLowerCase()] = value;
  headers.host = request.url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  // The path is already made of encoded segments (see S3MediaStorage); S3 doesn't encode it a second time.
  const canonicalPath = request.url.pathname || "/";
  const canonicalQuery = [...request.url.searchParams]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    request.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${keys.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${keys.secretAccessKey}`, day), keys.region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
