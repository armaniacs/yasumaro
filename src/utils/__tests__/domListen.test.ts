/**
 * domListen.test.ts
 * Unit tests for src/utils/domListen.ts.
 */
import { createListen } from '../domListen.js';

describe('domListen', () => {
  describe('createListen', () => {
    it('skips a null or undefined target without recording a remover', () => {
      const teardown: Array<() => void> = [];
      const listen = createListen(teardown);

      listen(null, 'click', () => {});
      listen(undefined, 'click', () => {});

      expect(teardown).toHaveLength(0);
    });

    it('runs the handler when the event fires', () => {
      const teardown: Array<() => void> = [];
      const listen = createListen(teardown);
      const target = new EventTarget();
      const handler = vi.fn();

      listen(target, 'click', handler);
      target.dispatchEvent(new Event('click'));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(teardown).toHaveLength(1);
    });

    it('removes every registered handler when the teardown list is drained', () => {
      const teardown: Array<() => void> = [];
      const listen = createListen(teardown);
      const target = new EventTarget();
      const onClick = vi.fn();
      const onFocus = vi.fn();
      listen(target, 'click', onClick);
      listen(target, 'focus', onFocus);

      for (const off of teardown.splice(0)) off();
      target.dispatchEvent(new Event('click'));
      target.dispatchEvent(new Event('focus'));

      expect(onClick).not.toHaveBeenCalled();
      expect(onFocus).not.toHaveBeenCalled();
      expect(teardown).toHaveLength(0);
    });
  });
});
