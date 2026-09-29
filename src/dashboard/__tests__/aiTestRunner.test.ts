// @vitest-environment jsdom
/**
 * aiTestRunner.test.ts
 * AI 接続テスト runner の単体テスト。
 *
 * 経過時間の interval は注入した intervalMs で駆動し、実時間待ちは使わない
 * （fake clock は waitPolicy の useTimerClock 経由のみ）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

vi.mock('../aiTestProgressClient.js', () => ({
  subscribeAiTestProgress: vi.fn(),
  generateAiTestRunId: vi.fn(() => 'run-fixed'),
}));

vi.mock('../aiTestProgressView.js', () => ({
  buildAiTestProgressView: vi.fn(() => ({
    label: document.createElement('span'),
    elapsedEl: document.createElement('div'),
  })),
  renderAiTestProgressLabel: vi.fn(),
  renderAiTestProgressElapsed: vi.fn(),
}));

vi.mock('../aiTestResultView.js', () => ({
  formatProviderHeadline: vi.fn((p: { provider: string }) => `headline:${p.provider}`),
  formatProviderDetailLines: vi.fn(() => ['detail-a', 'detail-b']),
}));

import { runAiConnectionTest, renderAiTestProviderLines } from '../aiTestRunner.js';
import { subscribeAiTestProgress, generateAiTestRunId } from '../aiTestProgressClient.js';
import { renderAiTestProgressLabel, renderAiTestProgressElapsed } from '../aiTestProgressView.js';

const mockedSubscribe = vi.mocked(subscribeAiTestProgress);
const mockedRunId = vi.mocked(generateAiTestRunId);
const mockedRenderLabel = vi.mocked(renderAiTestProgressLabel);
const mockedRenderElapsed = vi.mocked(renderAiTestProgressElapsed);

type ProgressListener = (progress: { provider: string; index: number; total: number }) => void;

interface Harness {
  target: HTMLElement;
  run: ReturnType<typeof vi.fn>;
  draw: {
    onProviderAnnounced: ReturnType<typeof vi.fn>;
    onProgressStarted: ReturnType<typeof vi.fn>;
    onResultRendered: ReturnType<typeof vi.fn>;
    multiProviderSummary: ReturnType<typeof vi.fn>;
    singleProviderSummary: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
  };
  onStart: ReturnType<typeof vi.fn>;
  onFinish: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  emitProgress: (progress: { provider: string; index: number; total: number }) => void;
}

function harness(result: unknown = { success: true, message: 'ok', providers: [] }): Harness {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const unsubscribe = vi.fn();
  let listener: ProgressListener | undefined;
  mockedSubscribe.mockImplementation((_runId, onProgress) => {
    listener = onProgress as ProgressListener;
    return unsubscribe;
  });
  return {
    target,
    run: vi.fn().mockResolvedValue(result),
    draw: {
      onProviderAnnounced: vi.fn(),
      onProgressStarted: vi.fn(),
      onResultRendered: vi.fn(),
      multiProviderSummary: vi.fn((el: HTMLElement) => { el.textContent = 'multi-summary'; }),
      singleProviderSummary: vi.fn((el: HTMLElement) => { el.textContent = 'single-summary'; }),
      onError: vi.fn(),
    },
    onStart: vi.fn(),
    onFinish: vi.fn(),
    unsubscribe,
    emitProgress: (progress) => listener?.(progress),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRunId.mockReturnValue('run-fixed');
  mockedSubscribe.mockReturnValue(vi.fn());
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('runAiConnectionTest', () => {
  it('sends the generated runId to the transport and unsubscribes afterwards', async () => {
    const h = harness();
    const outcome = await runAiConnectionTest({
      target: h.target,
      run: h.run,
      onStart: h.onStart,
      onFinish: h.onFinish,
      draw: h.draw,
    });

    expect(outcome).toBe('ran');
    expect(mockedRunId).toHaveBeenCalledTimes(1);
    expect(mockedSubscribe).toHaveBeenCalledWith('run-fixed', expect.any(Function));
    expect(h.run).toHaveBeenCalledWith('run-fixed');
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onFinish).toHaveBeenCalledTimes(1);
  });

  it('holds a single in-flight guard for every caller of the runner', async () => {
    const first = harness();
    const second = harness();
    let releaseFirst: (() => void) | undefined;
    first.run.mockImplementation(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ success: true, message: 'ok', providers: [] });
    }));

    const firstRun = runAiConnectionTest({ target: first.target, run: first.run, draw: first.draw });
    // The second surface is a different element set but the same guard.
    const secondOutcome = await runAiConnectionTest({ target: second.target, run: second.run, draw: second.draw });

    expect(secondOutcome).toBe('guarded');
    expect(second.run).not.toHaveBeenCalled();
    expect(second.draw.onError).not.toHaveBeenCalled();

    releaseFirst!();
    expect(await firstRun).toBe('ran');

    // The guard is released with the run, so the next request goes through.
    const third = harness();
    expect(await runAiConnectionTest({ target: third.target, run: third.run, draw: third.draw })).toBe('ran');
  });

  it('releases the guard when the run rejects', async () => {
    const failing = harness();
    failing.run.mockRejectedValue(new Error('send boom'));

    const outcome = await runAiConnectionTest({
      target: failing.target,
      run: failing.run,
      onFinish: failing.onFinish,
      draw: failing.draw,
    });

    expect(outcome).toBe('failed');
    expect(failing.draw.onError).toHaveBeenCalledWith(failing.target, expect.any(Error));
    expect(failing.onFinish).toHaveBeenCalledTimes(1);
    expect(failing.unsubscribe).toHaveBeenCalledTimes(1);

    const next = harness();
    expect(await runAiConnectionTest({ target: next.target, run: next.run, draw: next.draw })).toBe('ran');
  });

  it('skips the request when prepare returns false but still cleans up', async () => {
    const h = harness();
    const prepare = vi.fn().mockResolvedValue(false);

    const outcome = await runAiConnectionTest({
      target: h.target,
      run: h.run,
      prepare,
      onFinish: h.onFinish,
      draw: h.draw,
    });

    expect(outcome).toBe('aborted');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.onFinish).toHaveBeenCalledTimes(1);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('runs the request when prepare resolves undefined', async () => {
    const h = harness();
    const prepare = vi.fn();

    const outcome = await runAiConnectionTest({
      target: h.target,
      run: h.run,
      prepare,
      draw: h.draw,
    });

    expect(outcome).toBe('ran');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledWith('run-fixed');
  });

  it('renders the initial progress frame before sending anything', async () => {
    const h = harness();
    let renderWhenRunStarted: number | undefined;
    h.run.mockImplementation(async () => {
      renderWhenRunStarted = mockedRenderLabel.mock.calls.length;
      return { success: true, message: 'ok', providers: [] };
    });

    await runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });

    expect(renderWhenRunStarted).toBe(1);
    expect(mockedRenderElapsed).toHaveBeenCalled();
    expect(h.draw.onProgressStarted).toHaveBeenCalledTimes(1);
  });

  it('ticks the elapsed view on the injected interval, not a fixed wait', async () => {
    useTimerClock();
    const h = harness();
    let releaseRun: (() => void) | undefined;
    h.run.mockImplementation(() => new Promise((resolve) => { releaseRun = () => resolve({ success: true, message: 'ok', providers: [] }); }));

    const pending = runAiConnectionTest({ target: h.target, run: h.run, intervalMs: 5000, draw: h.draw });
    const rendersBeforeTick = mockedRenderElapsed.mock.calls.length;

    await vi.advanceTimersByTimeAsync(4999);
    expect(mockedRenderElapsed.mock.calls.length).toBe(rendersBeforeTick);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedRenderElapsed.mock.calls.length).toBe(rendersBeforeTick + 1);

    releaseRun!();
    await pending;
  });

  it('defaults the elapsed interval to 200ms', async () => {
    useTimerClock();
    const h = harness();
    let releaseRun: (() => void) | undefined;
    h.run.mockImplementation(() => new Promise((resolve) => { releaseRun = () => resolve({ success: true, message: 'ok', providers: [] }); }));

    const pending = runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });
    const rendersBeforeTick = mockedRenderElapsed.mock.calls.length;

    await vi.advanceTimersByTimeAsync(200);
    expect(mockedRenderElapsed.mock.calls.length).toBe(rendersBeforeTick + 1);

    releaseRun!();
    await pending;
  });

  it('mirrors the elapsed view into the injected target element', async () => {
    useTimerClock();
    const h = harness();
    const mirror = document.createElement('div');
    document.body.appendChild(mirror);
    let releaseRun: (() => void) | undefined;
    h.run.mockImplementation(() => new Promise((resolve) => { releaseRun = () => resolve({ success: true, message: 'ok', providers: [] }); }));

    const pending = runAiConnectionTest({
      target: h.target,
      run: h.run,
      intervalMs: 100,
      draw: { ...h.draw, elapsedMirror: mirror },
    });
    const rendersBeforeTick = mockedRenderElapsed.mock.calls.length;

    await vi.advanceTimersByTimeAsync(100);
    expect(mockedRenderElapsed.mock.calls.length).toBe(rendersBeforeTick + 1);
    expect(mockedRenderElapsed.mock.calls.at(-1)?.[2]).toBe(mirror);

    releaseRun!();
    await pending;
  });

  it('announces a provider switch once per provider/index change', async () => {
    const h = harness();
    let releaseRun: (() => void) | undefined;
    h.run.mockImplementation(() => new Promise((resolve) => { releaseRun = () => resolve({ success: true, message: 'ok', providers: [] }); }));

    const pending = runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });

    h.emitProgress({ provider: 'gemini', index: 0, total: 2 });
    expect(h.draw.onProviderAnnounced).toHaveBeenCalledTimes(1);
    expect(mockedRenderLabel).toHaveBeenLastCalledWith(expect.anything(), { provider: 'gemini', index: 0, total: 2 });

    // Same provider and slot: only the elapsed time moves, no re-announcement.
    h.emitProgress({ provider: 'gemini', index: 0, total: 2 });
    expect(h.draw.onProviderAnnounced).toHaveBeenCalledTimes(1);

    h.emitProgress({ provider: 'openai', index: 1, total: 2 });
    expect(h.draw.onProviderAnnounced).toHaveBeenCalledTimes(2);

    releaseRun!();
    await pending;
  });

  it('appends one headline and detail row per provider for a multi-provider result', async () => {
    const providers = [
      { provider: 'gemini', success: true, message: 'ok', elapsedMs: 1 },
      { provider: 'openai', success: false, message: 'nope', elapsedMs: 2 },
    ];
    const h = harness({ success: false, message: 'partial', providers });

    await runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });

    expect(h.draw.multiProviderSummary).toHaveBeenCalledTimes(1);
    expect(h.draw.singleProviderSummary).not.toHaveBeenCalled();

    const rows = Array.from(h.target.querySelectorAll('div.diag-indent')) as HTMLElement[];
    const headlines = rows.filter((row) => row.textContent?.startsWith('headline:'));
    expect(headlines.map((row) => row.textContent)).toEqual(['headline:gemini', 'headline:openai']);
    expect(headlines[0]!.className).toContain('diag-success');
    expect(headlines[1]!.className).toContain('diag-error');

    const details = Array.from(h.target.querySelectorAll('.ai-debug-details')) as HTMLElement[];
    expect(details.map((row) => row.textContent)).toEqual([
      'detail-a', 'detail-b', 'detail-a', 'detail-b',
    ]);
    expect(h.draw.onResultRendered).toHaveBeenCalledWith(h.target, expect.objectContaining({ success: false }));
  });

  it('renders only the single-provider summary when one slot answered', async () => {
    const h = harness({
      success: true,
      message: 'ok',
      providers: [{ provider: 'gemini', success: true, message: 'ok', elapsedMs: 1 }],
    });

    await runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });

    expect(h.draw.singleProviderSummary).toHaveBeenCalledTimes(1);
    expect(h.draw.multiProviderSummary).not.toHaveBeenCalled();
    expect(h.target.querySelectorAll('.ai-debug-details')).toHaveLength(0);
  });

  it('replaces the in-progress frame instead of appending to it', async () => {
    const h = harness();
    h.target.textContent = 'stale';

    await runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });

    expect(h.target.textContent).toBe('single-summary');
  });

  it('leaves the target to the caller when the provider list is missing', async () => {
    const h = harness({ success: true, message: 'ok' } as never);

    await runAiConnectionTest({ target: h.target, run: h.run, draw: h.draw });

    expect(h.draw.singleProviderSummary).toHaveBeenCalledTimes(1);
    expect(h.target.querySelectorAll('.ai-debug-details')).toHaveLength(0);
  });

  it('releases the guard when the progress view cannot be built', async () => {
    const h = harness();
    const { buildAiTestProgressView } = await import('../aiTestProgressView.js');
    vi.mocked(buildAiTestProgressView).mockImplementationOnce(() => { throw new Error('build fail'); });

    await expect(runAiConnectionTest({ target: h.target, run: h.run, onFinish: h.onFinish, draw: h.draw }))
      .rejects.toThrow('build fail');
    expect(h.onFinish).toHaveBeenCalledTimes(1);
    vi.mocked(buildAiTestProgressView).mockClear();

    const next = harness();
    expect(await runAiConnectionTest({ target: next.target, run: next.run, draw: next.draw })).toBe('ran');
  });
});

describe('renderAiTestProviderLines', () => {
  it('appends nothing for an empty provider list', () => {
    const target = document.createElement('div');
    renderAiTestProviderLines(target, []);
    expect(target.childNodes).toHaveLength(0);
  });

  it('renders the detail lines in pre-wrap friendly row elements', () => {
    const target = document.createElement('div');
    renderAiTestProviderLines(target, [
      { provider: 'gemini', success: true, message: 'ok', elapsedMs: 1 },
    ]);

    const children = Array.from(target.children) as HTMLElement[];
    expect(children.map((child) => child.className)).toEqual([
      'diag-indent diag-success',
      'diag-indent ai-debug-details',
      'diag-indent ai-debug-details',
    ]);
    expect(children[0]!.textContent).toBe('headline:gemini');
  });
});
