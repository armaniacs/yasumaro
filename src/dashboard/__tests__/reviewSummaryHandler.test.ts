// @vitest-environment jsdom
/**
 * reviewSummaryHandler.test.ts
 *
 * Moved here from dashboard.test.ts with PBI-24: those tests went through
 * handleGenerateWeeklySummary / handleGenerateMonthlySummary, which were
 * three-line shells that looked up two elements and delegated. Now that the
 * shells live inside generalSettingsPanel as private helpers, the behaviour
 * they covered is tested against generateReviewSummary directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReviewSummary } from '../reviewSummaryHandler.js';

function setupDom(): { button: HTMLButtonElement; statusElement: HTMLElement } {
  document.body.innerHTML = `
    <button id="generateSummaryBtn"></button>
    <div id="reviewSummaryStatus"></div>
  `;
  return {
    button: document.getElementById('generateSummaryBtn') as HTMLButtonElement,
    statusElement: document.getElementById('reviewSummaryStatus') as HTMLElement,
  };
}

function givenResponse(response: unknown): ReturnType<typeof vi.fn> {
  const sendMessage = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: { sendMessage },
    i18n: { getMessage: vi.fn(() => '') },
  });
  return sendMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateReviewSummary', () => {
  it('sends GENERATE_REVIEW_SUMMARY with periodType weekly', async () => {
    const { button, statusElement } = setupDom();
    const sendMessage = givenResponse({ success: true, generated: true });

    await generateReviewSummary({ button, statusElement, periodType: 'weekly' });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'GENERATE_REVIEW_SUMMARY',
      payload: { periodType: 'weekly' },
    }));
    expect(statusElement.className).toBe('success');
  });

  it('sends GENERATE_REVIEW_SUMMARY with periodType monthly', async () => {
    const { button, statusElement } = setupDom();
    const sendMessage = givenResponse({ success: true, generated: true });

    await generateReviewSummary({ button, statusElement, periodType: 'monthly' });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'GENERATE_REVIEW_SUMMARY',
      payload: { periodType: 'monthly' },
    }));
    expect(statusElement.className).toBe('success');
  });

  it('shows info status when no entries were found', async () => {
    const { button, statusElement } = setupDom();
    givenResponse({ success: true, generated: false });

    await generateReviewSummary({ button, statusElement, periodType: 'weekly' });

    expect(statusElement.className).toBe('info');
  });

  it('shows error status when the service worker call fails', async () => {
    const { button, statusElement } = setupDom();
    givenResponse({ success: false, error: 'SQLite query failed' });

    await generateReviewSummary({ button, statusElement, periodType: 'weekly' });

    expect(statusElement.className).toBe('error');
  });

  it('re-enables the button even when the call fails', async () => {
    const { button, statusElement } = setupDom();
    givenResponse({ success: false });

    await generateReviewSummary({ button, statusElement, periodType: 'weekly' });

    expect(button.disabled).toBe(false);
  });

  it('does nothing when the elements are missing', async () => {
    const sendMessage = givenResponse({ success: true, generated: true });

    await generateReviewSummary({ button: null, statusElement: null, periodType: 'weekly' });

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
