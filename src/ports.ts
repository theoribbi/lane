import net from "node:net";

export type PortChecker = (port: number) => Promise<boolean>;

export function nextOffset(used: number[], stride = 10): number {
  const set = new Set(used);
  let off = stride;
  while (set.has(off)) off += stride;
  return off;
}

export async function bindPort(preferred: number, isFree: PortChecker): Promise<number> {
  let p = preferred;
  while (!(await isFree(p))) p += 1;
  return p;
}

export const isPortFreeReal: PortChecker = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
