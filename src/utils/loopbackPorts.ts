// @layer 0 — Foundation: loopback ports SSOT

/**
 * loopbackPorts.ts
 * SSOT for local loopback service ports shared by manifest host_permissions /
 * CSP connect-src generation (cspDomains.ts), runtime URL validation
 * (ssrfGuard.ts), and the e2e fixture (testDir/e2e/fixtures/localServers.ts).
 */

/** Loopback service ports (Obsidian Local REST, Ollama, LM Studio). */
export const LOOPBACK_PORTS = [27123, 27124, 11434, 1234] as const;
