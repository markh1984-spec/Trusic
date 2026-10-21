import type { FastifyRequest } from "fastify";
import type { Config } from "../config";

/**
 * The site's public address, for absolute links in link previews and share links: PUBLIC_URL when it's set,
 * otherwise the address the request came to (behind a proxy, from its X-Forwarded headers).
 */
export const siteUrl = (config: Config, request: FastifyRequest): string =>
  config.siteUrl ?? `${request.protocol}://${request.host}`;
