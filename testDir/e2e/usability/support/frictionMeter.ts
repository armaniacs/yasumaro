/**
 * frictionMeter.ts (PBI 2026-09-13-52)
 *
 * Wraps a Playwright Page's click()/fill() to count how many discrete user
 * actions a task takes. A rising count across commits is a proxy for the
 * task getting harder to complete, independent of whether the task's
 * functional assertions still pass.
 */
import type { Page } from '@playwright/test';

export class FrictionMeter {
  private steps = 0;

  constructor(private readonly page: Page) {}

  /** Click through the meter — counts as one user action. */
  async click(selector: string): Promise<void> {
    await this.page.locator(selector).click();
    this.steps++;
  }

  /** Fill through the meter — counts as one user action (one field filled). */
  async fill(selector: string, value: string): Promise<void> {
    await this.page.locator(selector).fill(value);
    this.steps++;
  }

  /** Total discrete actions recorded so far. */
  get count(): number {
    return this.steps;
  }

  reset(): void {
    this.steps = 0;
  }
}
