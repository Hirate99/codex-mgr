declare module "@bitkyc08/opencodex" {
  export function startServer(port?: number): unknown;
  export function loadBunApi(): Promise<{
    startServer: (port?: number) => unknown;
  }>;
}
