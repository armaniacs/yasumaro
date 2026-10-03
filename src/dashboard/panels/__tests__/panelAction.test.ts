// @vitest-environment jsdom
/**
 * panelAction.test.ts
 * The scaffold's contract, independent of any panel: whatever the operation
 * does, a button that went in enabled comes back enabled, and every failure
 * path reaches `onError`.
 */
import { describe, it, expect, vi } from 'vitest';
import { errorMessage } from '../../../utils/errorUtils.js';
import { abortPanelAction, runPanelAction, unwrapServiceResult } from '../panelAction.js';

function makeButton(label = 'Go'): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  return button;
}

describe('runPanelAction', () => {
  it('disables the buttons, runs the operation and renders the data', async () => {
    const button = makeButton();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const run = vi.fn(async () => ({ purged: 7 }));
    const seen: boolean[] = [];

    await runPanelAction({
      buttons: [button],
      run: async () => {
        seen.push(button.disabled);
        return run();
      },
      onSuccess,
      onError,
    });

    expect(seen).toEqual([true]);
    expect(onSuccess).toHaveBeenCalledWith({ purged: 7 });
    expect(onError).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it('re-enables the button and renders the reason for a { error } result', async () => {
    const button = makeButton();
    const onError = vi.fn();
    const onSuccess = vi.fn();

    await runPanelAction({
      buttons: [button],
      run: async () => unwrapServiceResult({ error: 'db locked' }),
      onSuccess,
      onError,
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('db locked', 'service', 'db locked');
    expect(button.disabled).toBe(false);
  });

  it('re-enables the button and renders the reason when the operation throws', async () => {
    const button = makeButton();
    const onError = vi.fn();

    await runPanelAction({
      buttons: [button],
      run: async () => {
        throw new Error('gateway down');
      },
      onError,
    });

    expect(onError).toHaveBeenCalledWith('gateway down', 'thrown', expect.any(Error));
    expect(button.disabled).toBe(false);
  });

  it('re-enables the buttons even when the render step throws', async () => {
    const button = makeButton();
    const onError = vi.fn();

    await runPanelAction({
      buttons: [button],
      run: async () => 1,
      onSuccess: () => {
        throw new Error('render blew up');
      },
      onError,
    });

    expect(onError).toHaveBeenCalledWith('render blew up', 'thrown', expect.any(Error));
    expect(button.disabled).toBe(false);
  });

  it('swallows a throw from onError instead of rejecting, and still restores the buttons', async () => {
    const button = makeButton();

    await expect(
      runPanelAction({
        buttons: [button],
        run: async () => {
          throw new Error('gateway down');
        },
        onError: () => {
          throw new Error('error display blew up');
        },
      }),
    ).resolves.toBeUndefined();
    expect(button.disabled).toBe(false);
  });

  it('swallows a throw from onError on the { error } path too', async () => {
    const button = makeButton();

    await expect(
      runPanelAction({
        buttons: [button],
        run: async () => unwrapServiceResult({ error: 'db locked' }),
        onError: () => {
          throw new Error('error display blew up');
        },
      }),
    ).resolves.toBeUndefined();
    expect(button.disabled).toBe(false);
  });

  it('records a throw from onError through console.error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runPanelAction({
      run: async () => {
        throw new Error('gateway down');
      },
      onError: () => {
        throw new Error('error display blew up');
      },
    });

    expect(logged).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    logged.mockRestore();
  });

  it('swaps the first button label while busy and puts it back afterwards', async () => {
    const button = makeButton('Convert');
    const other = makeButton('Other');
    const seen: string[] = [];

    await runPanelAction({
      buttons: [button, other],
      busyLabel: 'Working...',
      run: async () => {
        seen.push(button.textContent ?? '');
        seen.push(other.textContent ?? '');
      },
    });

    expect(seen).toEqual(['Working...', 'Other']);
    expect(button.textContent).toBe('Convert');
    expect(other.disabled).toBe(false);
  });

  it('restores the label and the buttons after a failure', async () => {
    const button = makeButton('Convert');

    await runPanelAction({
      buttons: [button],
      busyLabel: 'Working...',
      run: async () => {
        throw new Error('nope');
      },
      onError: vi.fn(),
    });

    expect(button.textContent).toBe('Convert');
    expect(button.disabled).toBe(false);
  });

  it('tolerates null buttons in the control set', async () => {
    const button = makeButton();

    await runPanelAction({
      buttons: [null, button, undefined],
      run: async () => {
        expect(button.disabled).toBe(true);
      },
    });

    expect(button.disabled).toBe(false);
  });

  it('reports busy state to onBusy and clears it afterwards', async () => {
    const button = makeButton();
    const states: boolean[] = [];

    await runPanelAction({
      buttons: [button],
      onBusy: (busy) => states.push(busy),
      run: async () => {
        states.push(button.disabled);
      },
    });

    expect(states).toEqual([true, true, false]);
  });

  it('renders the in-progress message before running the operation', async () => {
    const order: string[] = [];

    await runPanelAction({
      onStart: () => order.push('start'),
      run: async () => {
        order.push('run');
      },
    });

    expect(order).toEqual(['start', 'run']);
  });

  it('aborts quietly but still restores the buttons', async () => {
    const button = makeButton();
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await runPanelAction({
      buttons: [button],
      run: async () => {
        expect(button.disabled).toBe(true);
        return abortPanelAction();
      },
      onSuccess,
      onError,
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });
});

describe('unwrapServiceResult', () => {
  it('returns the data for a successful result', () => {
    expect(unwrapServiceResult({ data: [1, 2] })).toEqual([1, 2]);
  });

  it('throws with the service reason for a failed result', () => {
    expect(() => unwrapServiceResult({ error: 'quota exceeded' })).toThrow('quota exceeded');
  });

  it('stays readable through errorMessage for nested handlers', () => {
    let caught: unknown;
    try {
      unwrapServiceResult({ error: 'nested failure' });
    } catch (err) {
      caught = err;
    }
    expect(errorMessage(caught)).toBe('nested failure');
  });
});