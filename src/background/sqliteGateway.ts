// @layer 1 — Facade shim (PBI 07)
// Split into sqlite/offscreenGateway.ts and sqlite/dashboardGateway.ts for locality.
// This file re-exports both for backward compat; new code should import from the split files.

export * from './sqlite/offscreenGateway.js';
export * from './sqlite/dashboardGateway.js';
