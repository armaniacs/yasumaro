// @layer 1 — Facade shim (PBI 07, narrowed in PBI 11)
// Split into sqlite/offscreenGateway.ts and messaging/dashboardGateway.ts for locality.
// This file re-exports the offscreen hop for backward compat; dashboard code
// imports DashboardGateway directly from messaging/dashboardGateway.js.

export * from './sqlite/offscreenGateway.js';
