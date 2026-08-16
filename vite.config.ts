import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { startOpencodex } from "./src/opencodex-adapter";
import { loadSecrets } from "./src/secrets";

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
      // 并发拉起 opencodex（dev 模式下不阻塞 Vite 启动）
      void startOpencodex(
        undefined,
        loadSecrets()["OPENCODE_GO_API_KEY"] ?? loadSecrets()["OPENCODE_API_KEY"],
      ).then((result) => {
        if (result.running) {
          console.log(`OpenCodex 适配器已启动: http://127.0.0.1:${result.port}`);
        } else {
          console.warn(`OpenCodex 适配器未启动: ${result.error ?? "请检查依赖"}`);
        }
      });
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
