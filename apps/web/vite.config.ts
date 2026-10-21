import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const apiTarget = process.env.TRUSIC_API_URL ?? "http://127.0.0.1:3001";

/** Embedded players (/embed/…) are their own small page, embed.html. In production the API serves it. */
function embedPages(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url?.startsWith("/embed/")) req.url = "/embed.html";
    next();
  };
  return {
    name: "trusic-embed-pages",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig({
  plugins: [react(), embedPages()],
  build: {
    rolldownOptions: { input: { main: "index.html", embed: "embed.html" } },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
});
