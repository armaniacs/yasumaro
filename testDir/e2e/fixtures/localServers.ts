/**
 * localServers.ts — e2e helper for binding fixture HTTP servers on PERMITTED
 * loopback ports (PBI 2026-09-22-04/05).
 *
 * WHY a port picker instead of a fixed port: the manifest only grants
 * `host_permissions` for the four AI/obsidian loopback ports
 * (ssrfGuard.ALLOWED_LOCALHOST_PORTS = 11434, 27123, 27124, 1234), and any of
 * them can be occupied on a developer machine — 1234 is the REAL LM Studio
 * desktop app's port (observed owning 127.0.0.1:1234), 27124 is Obsidian
 * Local REST, 11434 is Ollama. Binding must (a) stay inside the granted set
 * so sender.tab.url/AI fetches are permitted, and (b) probe-and-skip
 * occupied ports instead of failing with EADDRINUSE.
 *
 * Binding always targets 127.0.0.1 explicitly: a bare `listen(port)` can end
 * up IPv6-only while the consumer addresses127.0.0.1 (or vice versa), which
 * silently misses the server — observed during the regenerate e2e bring-up.
 */

import { createServer, type Server } from 'node:http';

/** Permitted loopback ports, preferred order (least contested first). */
export const PERMITTED_LOOPBACK_PORTS = [11434, 27123, 27124, 1234] as const;

export async function pickLoopbackPort(
  candidates: readonly number[] = PERMITTED_LOOPBACK_PORTS,
  host = '127.0.0.1',
): Promise<number> {
  for (const port of candidates) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, host, () => {
        probe.close(() => resolve(true));
      });
    });
    if (free) return port;
  }
  throw new Error(
    `no permitted loopback port is free (tried ${candidates.join(', ')}) — close the local AI/Obsidian services and retry`,
  );
}

/** listen() with an explicit host, awaiting BOTH bind success and failure. */
export async function listenHttp(server: Server, port: number, host = '127.0.0.1'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}
