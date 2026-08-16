import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "../src/http/api";
import { startOpencodex } from "../src/opencodex-adapter";
import { loadSecrets } from "../src/secrets";

// 尽早注册信号处理。OpenCodex 是独立 detached 进程，面板退出时不得连带停止它。
let shuttingDown = false;
let panelServer: { stop: (force?: boolean) => void } | undefined;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在退出面板…`);
  // 兜底：若优雅停止被挂起，1.5s 后强制退出。
  setTimeout(() => process.exit(0), 1500).unref();
  try {
    panelServer?.stop(true);
  } catch {
    /* 面板可能尚未启动 */
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
try {
  process.on("SIGBREAK", () => shutdown("SIGBREAK"));
} catch {
  /* 不支持该信号的环境忽略 */
}

const startupSecrets = loadSecrets();
// 并发拉起 opencodex，不阻塞面板服务启动
void startOpencodex(
  undefined,
  startupSecrets["OPENCODE_GO_API_KEY"] ?? startupSecrets["OPENCODE_API_KEY"],
).then((opencodex) => {
  if (opencodex.running) {
    console.log(`OpenCodex 适配器已启动: http://127.0.0.1:${opencodex.port}`);
  } else {
    console.warn(`OpenCodex 适配器未启动: ${opencodex.error ?? "请检查依赖"}`);
  }
});

const CLIENT_DIR = resolve(process.cwd(), "dist", "client");
const SERVER_ENTRY = resolve(process.cwd(), "dist", "server", "server.js");

if (!existsSync(SERVER_ENTRY)) {
  console.error("未找到构建产物 dist/server/server.js，请先运行 bun run build");
  process.exit(1);
}

// 构建产物里的虚拟模块（#tanstack-router-entry 等）已被 Vite 内联，
// 直接在 Bun 里加载即可，不再依赖 @tanstack/react-start/server-entry。
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
    console.log(`codex-mgr 面板: http://127.0.0.1:${p}`);
    break;
  } catch (e: any) {
    if (e?.code === "EADDRINUSE" || String(e).includes("in use")) continue;
    throw e;
  }
}
