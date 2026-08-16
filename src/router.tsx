import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: () => (
      <div className="empty-state">
        <strong>Page not found</strong>
        <p>The resource you are looking for does not exist or the link is no longer valid.</p>
        <a className="btn primary" href="/">Back to console</a>
      </div>
    ),
    defaultErrorComponent: ({ error }) => (
      <div className="empty-state">
        <strong>Failed to load page</strong>
        <p>{String(error)}</p>
        <a className="btn primary" href="/">Back to console</a>
      </div>
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
