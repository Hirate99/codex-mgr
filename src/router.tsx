import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: () => (
      <div className="empty-state">
        <strong>页面不存在</strong>
        <p>要访问的资源不存在或链接已失效。</p>
        <a className="btn primary" href="/">返回控制台</a>
      </div>
    ),
    defaultErrorComponent: ({ error }) => (
      <div className="empty-state">
        <strong>页面加载失败</strong>
        <p>{String(error)}</p>
        <a className="btn primary" href="/">返回控制台</a>
      </div>
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
