import { showStatus, type ShowStatusOptions, type StatusType } from './settingsUiHelper.js';

export interface StatusTargetBinding {
  /**
   * Mirror hook run after each report to this target. No surface registers it
   * yet (the dashboard keeps `showStatus` + `syncStatusToTop` per call site);
   * the channel never imports entry code so the utils → entry dependency
   * direction stays intact.
   */
  mirror?: () => void;
  defaultTtlMs?: number;
}

/**
 * StatusChannel centralizes status display policy (mirror + TTL defaults)
 * behind one seam.
 *
 * Render itself stays in `showStatus`; this module owns where a report goes
 * and which policy applies, so callers stop choosing element ids, durations,
 * and mirror flags per call site. Each surface registers its bindings where
 * it already owns setup (dashboard `statusView.ts`, popup `statusPanel.ts`).
 */
export class StatusChannel {
  private readonly bindings = new Map<string, StatusTargetBinding>();

  register(targetId: string, binding: StatusTargetBinding): void {
    this.bindings.set(targetId, binding);
  }

  report(
    target: string | HTMLElement,
    message: string,
    type: StatusType,
    options: ShowStatusOptions = {},
  ): void {
    const targetId = typeof target === 'string' ? target : target.id;
    const binding = this.bindings.get(targetId);
    const resolved: ShowStatusOptions = { ...options };
    if (resolved.durationMs === undefined && binding?.defaultTtlMs !== undefined) {
      resolved.durationMs = binding.defaultTtlMs;
    }
    showStatus(target, message, type, resolved);
    binding?.mirror?.();
  }
}

/** Shared channel. Surfaces register their bindings at setup time. */
export const statusChannel = new StatusChannel();
