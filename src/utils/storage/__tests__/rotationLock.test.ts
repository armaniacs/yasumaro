import { describe, it, expect, vi } from 'vitest';
import { withRotationLock, RotationInProgressError, ROTATION_LOCK_NAME } from '../rotationLock.js';

function grantedManager(): { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) =>
      callback({}),
    ) as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('withRotationLock', () => {
  it('runs fn and returns its value when the lock is granted', async () => {
    const granted = grantedManager() as unknown as Pick<LockManager, 'request'>;
    await expect(withRotationLock(async () => 'ok', granted)).resolves.toBe('ok');
  });

  it('requests an exclusive ifAvailable lock under the fixed name', async () => {
    const granted = grantedManager();
    await withRotationLock(
      async () => 'ok',
      granted as unknown as Pick<LockManager, 'request'>,
    );
    expect(granted.request).toHaveBeenCalledWith(
      ROTATION_LOCK_NAME,
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
  });

  it('rejects with RotationInProgressError and skips fn when the lock is unavailable', async () => {
    const denied = {
      request: vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) =>
        callback(null),
      ),
    } as unknown as Pick<LockManager, 'request'>;
    const fn = vi.fn(async () => 'never');
    await expect(withRotationLock(fn, denied)).rejects.toBeInstanceOf(RotationInProgressError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('fails closed when the Web Locks API is missing', async () => {
    const fn = vi.fn(async () => 'never');
    await expect(withRotationLock(fn, null)).rejects.toThrow(/ROTATION_LOCK_UNAVAILABLE/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('releases the lock when fn throws', async () => {
    await expect(withRotationLock(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await expect(withRotationLock(async () => 'again')).resolves.toBe('again');
    const held = ((await navigator.locks.query()).held ?? []).map((entry) => entry.name);
    expect(held).not.toContain(ROTATION_LOCK_NAME);
  });

  it('is not re-entrant: a nested call fails instead of deadlocking', async () => {
    await expect(
      withRotationLock(() => withRotationLock(async () => 'x')),
    ).rejects.toBeInstanceOf(RotationInProgressError);
  });

  it('rejects the second of two concurrent callers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pendingA = withRotationLock(() => gate);
    await expect(withRotationLock(async () => 'b')).rejects.toBeInstanceOf(RotationInProgressError);
    release();
    await pendingA;
  });
});
