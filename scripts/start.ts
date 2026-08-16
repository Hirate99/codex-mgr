import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { api } from "../src/http/api";
import { startOpencodex } from "../src/opencodex-adapter";
import { loadSecrets } from "../src/secrets";
import { panelLogPath, panelStatePath } from "../src/paths";


// Register signal handling early. OpenCodex is an independent detached process and
// must not be stopped together with the panel.
let shuttingDown = false;
let panelServer: { stop: (force?: boolean) => void } | undefined;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down the panel...`);
  // Fallback: force-exit after 1.5s if graceful shutdown hangs.
  setTimeout(() => process.exit(0), 1500).unref();
  try {
    panelServer?.stop(true);
  } catch {
    /* The panel may not have started yet */
  }
  try {
    if (existsSync(panelStatePath())) writeFileSync(panelStatePath(), "", "utf8");
  } catch {
    /* State-file cleanup is best effort */
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
try {
  process.on("SIGBREAK", () => shutdown("SIGBREAK"));
} catch {
  /* Ignored on platforms that do not support this signal */
}

const startupSecrets = loadSecrets();
// Start opencodex concurrently without blocking panel startup
void startOpencodex(
  undefined,
  startupSecrets["OPENCODE_GO_API_KEY"] ?? startupSecrets["OPENCODE_API_KEY"],
).then((opencodex) => {
  if (opencodex.running) {
    console.log(`OpenCodex adapter started: http://127.0.0.1:${opencodex.port}`);
  } else {
    console.warn(`OpenCodex adapter not started: ${opencodex.error ?? "check dependencies"}`);
  }
});

const CLIENT_DIR = resolve(process.cwd(), "dist", "client");
const SERVER_ENTRY = resolve(process.cwd(), "dist", "server", "server.js");

if (!existsSync(SERVER_ENTRY)) {
  console.error("Build output dist/server/server.js not found; run bun run build first");
  process.exit(1);
}

// Virtual modules in the build output (#tanstack-router-entry etc.) are already inlined
// by Vite; load them directly in Bun without depending on @tanstack/react-start/server-entry.
const serverEntry = await import(`file://${SERVER_ENTRY.replace(/\\/g, "/")}`);
const startHandler = serverEntry.default as { fetch: (request: Request) => Promise<Response> };

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function serveAsset(url: URL): Response {
  const rel = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
  const filePath = resolve(CLIENT_DIR, rel);
  if (!filePath.toLowerCase().startsWith(CLIENT_DIR.toLowerCase())) {
    return new Response("Not Found", { status: 404 });
  }
  if (!existsSync(filePath)) return new Response("Not Found", { status: 404 });
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
  });
}

const basePort = Number(process.env.PORT ?? 9810);

for (let p = basePort; p < basePort + 50; p++) {
  try {
    const server = Bun.serve({
      port: p,
      hostname: "127.0.0.1",
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/")) return api.fetch(request);
        if (url.pathname.startsWith("/assets/")) return serveAsset(url);
        return startHandler.fetch(request);
      },
    });
    panelServer = server;
    console.log(`codex-mgr panel: http://127.0.0.1:${p}`);
    writeFileSync(
      panelStatePath(),
      JSON.stringify(
        {
          version: 1,
          pid: process.pid,
          port: p,
          startedAt: new Date().toISOString(),
          log: panelLogPath(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    break;
  } catch (e: any) {
    if (e?.code === "EADDRINUSE" || String(e).includes("in use")) continue;
    throw e;
  }
}
