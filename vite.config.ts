import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function apiMiddleware(): Plugin {
  return {
    name: "codex-mgr-api",
    configureServer(server) {
      // The API layer starts OpenCodex as a detached Bun subprocess. Starting it from
      // Vite's Node process was dev-only behavior and failed the package's Bun check.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "/";
        if (!url.startsWith("/api/")) return next();
        try {
          const mod = (await server.ssrLoadModule("/src/http/api")) as {
            api: { fetch: (r: Request) => Promise<Response> };
          };
          const webReq = new Request(`http://${req.headers.host ?? "localhost"}${url}`, {
            method: req.method,
            headers: new Headers(req.headers as Record<string, string>),
            body:
              req.method === "GET" || req.method === "HEAD" || req.method === "DELETE"
                ? undefined
                : new Uint8Array(await readBody(req)),
          });
          const response = await mod.api.fetch(webReq);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(new Uint8Array(await response.arrayBuffer()));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e?.message ?? "API error" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [apiMiddleware(), tanstackStart(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 9810,
    host: "127.0.0.1",
  },
});
