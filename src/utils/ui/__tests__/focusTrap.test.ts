// @vitest-environment jsdom
/**
 * focusTrap.test.ts
 * focusTrap.ts の単体テスト
 */

// jsdom 環境が提供する document / HTMLElement をそのまま使用する
// (vitest 5 から環境グローバルへの直接代入は不可のため、手動 JSDOM 構築は廃止)

import {
    FocusTrapManager,
    focusTrapManager,
    trapFocus,
    releaseFocusTrap,
    getFocusableElements
} from '../focusTrap.js';

describe('focusTrap', () => {
    let manager: FocusTrapManager;

    beforeEach(() => {
        manager = new FocusTrapManager();
        document.body.innerHTML = `
            <div id="modal">
                <button id="btn1">Button 1</button>
                <input id="input1" type="text" />
                <button id="btn2">Button 2</button>
            </div>
            <button id="outside">Outside</button>
        `;
    });

    afterEach(() => {
        manager.releaseAll();
    });

    describe('FocusTrapManager', () => {
        test('starts with empty handlers', () => {
            expect(manager.handlers.size).toBe(0);
            expect(manager.previousFocus.size).toBe(0);
        });

        describe('trap', () => {
            test('accepts an HTMLElement', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                const trapId = manager.trap(modal);

                expect(trapId).toMatch(/^focusTrap_/);
                expect(manager.handlers.has(trapId)).toBe(true);
            });

            test('accepts a string selector', () => {
                const trapId = manager.trap('#modal');

                expect(trapId).toMatch(/^focusTrap_/);
                expect(manager.handlers.has(trapId)).toBe(true);
            });

            test('throws for a nonexistent selector', () => {
                expect(() => manager.trap('#nonexistent')).toThrow('Modal element not found');
            });

            test('returns a trap ID and still registers the key handler when no focusable elements exist', () => {
                document.body.innerHTML = '<div id="empty-modal"></div>';
                const trapId = manager.trap('#empty-modal');

                expect(trapId).toMatch(/^focusTrap_/);
                // フォーカス可能要素が0件でも Escape で離脱できるよう、
                // keydown ハンドラは必ず登録される（release() の対象にもなる）
                expect(manager.handlers.has(trapId)).toBe(true);
                expect(manager.previousFocus.has(trapId)).toBe(true);
            });

            test('generates a different trap ID each time', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                const id1 = manager.trap(modal);
                const id2 = manager.trap(modal);

                expect(id1).not.toBe(id2);
            });
        });

        describe('release', () => {
            test('releases the trap', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                const trapId = manager.trap(modal);

                manager.release(trapId);

                expect(manager.handlers.has(trapId)).toBe(false);
                expect(manager.previousFocus.has(trapId)).toBe(false);
            });

            test('is a no-op for a nonexistent trap ID', () => {
                expect(() => manager.release('nonexistent')).not.toThrow();
            });

            test('releases a trap that had no focusable element', () => {
                document.body.innerHTML = '<div id="empty-modal"></div>';
                const modal = document.getElementById('empty-modal') as HTMLElement;
                const trapId = manager.trap(modal);

                manager.release(trapId);

                expect(manager.handlers.has(trapId)).toBe(false);
                expect(manager.previousFocus.has(trapId)).toBe(false);
            });
        });

        describe('releaseAll', () => {
            test('releases all traps', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                manager.trap(modal);
                manager.trap(modal);

                expect(manager.handlers.size).toBe(2);

                manager.releaseAll();

                expect(manager.handlers.size).toBe(0);
                expect(manager.previousFocus.size).toBe(0);
            });

            test('is a no-op when no traps exist', () => {
                expect(() => manager.releaseAll()).not.toThrow();
            });
        });

    describe('generateId', () => {
        test('generates a unique ID', () => {
            const id1 = manager.generateId();
            const id2 = manager.generateId();

            // PBI 2026-10-20-21: the opaque part follows the SSOT
            // (crypto.randomUUID or 128-bit hex) behind the focusTrap_ prefix.
            expect(id1).toMatch(/^focusTrap_/);
            expect(id1).not.toBe(id2);
        });
    });

    describe('keyboard handler', () => {
        test('calls closeCallback on Escape key', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const closeCallback = vi.fn();
            manager.trap(modal, closeCallback);

            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            modal.dispatchEvent(event);

            expect(closeCallback).toHaveBeenCalledTimes(1);
        });

        test('does nothing on Escape key when no closeCallback exists', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            manager.trap(modal);

            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            expect(() => modal.dispatchEvent(event)).not.toThrow();
        });

        test('calls closeCallback on Escape even when the trap has no focusable element', () => {
            // 全 disabled / 要素なしのモーダルでも Escape は唯一の離脱手段なので、
            // ハンドラ未登録のまま Escape が無視される状態を作ってはいけない。
            document.body.innerHTML = `
                <div id="empty-modal">
                    <button id="only" disabled>Disabled</button>
                </div>
            `;
            const modal = document.getElementById('empty-modal') as HTMLElement;
            const closeCallback = vi.fn();
            const trapId = manager.trap(modal, closeCallback);

            expect(manager.handlers.has(trapId)).toBe(true);

            modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

            expect(closeCallback).toHaveBeenCalledTimes(1);
        });

        test('leaves Tab alone when the trap has no focusable element', () => {
            document.body.innerHTML = '<div id="empty-modal"></div>';
            const modal = document.getElementById('empty-modal') as HTMLElement;
            manager.trap(modal);

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            expect(() => modal.dispatchEvent(event)).not.toThrow();
            // 空集合では循環対象が無いので preventDefault しない（無害）
            expect(event.defaultPrevented).toBe(false);
        });

        test('moves focus to the first element when Tab is pressed on the last element', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const btn2 = document.getElementById('btn2') as HTMLElement;
            manager.trap(modal);

            btn2.focus();
            expect(document.activeElement).toBe(btn2);

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            modal.dispatchEvent(event);

            expect(document.activeElement).toBe(document.getElementById('btn1'));
        });

        test('moves focus to the last element when Shift+Tab is pressed on the first element', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const btn1 = document.getElementById('btn1') as HTMLElement;
            manager.trap(modal);

            btn1.focus();
            expect(document.activeElement).toBe(btn1);

            const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
            modal.dispatchEvent(event);

            expect(document.activeElement).toBe(document.getElementById('btn2'));
        });

        test('keeps focus when Tab is pressed on a middle element', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const input1 = document.getElementById('input1') as HTMLElement;
            manager.trap(modal);

            input1.focus();

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            modal.dispatchEvent(event);

            // 中間要素なのでpreventDefaultは呼ばれない
            expect(document.activeElement).toBe(input1);
        });

        test('does nothing for non-Tab keys', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const closeCallback = vi.fn();
            manager.trap(modal, closeCallback);

            const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
            expect(() => modal.dispatchEvent(event)).not.toThrow();
            expect(closeCallback).not.toHaveBeenCalled();
        });

        test('calls closeCallback on Escape even when focus is outside the modal', () => {
            // Escape は activeElement に依らず onEscape へ回る。外側要素起点の
            // keydown は modalElement 束縛には届かない（document 束縛で届く）。
            const modal = document.getElementById('modal') as HTMLElement;
            const outside = document.getElementById('outside') as HTMLElement;
            const closeCallback = vi.fn();
            manager.trap(modal, closeCallback);

            outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

            expect(closeCallback).toHaveBeenCalledTimes(1);
        });

        test('moves focus back to the first element when Tab is pressed from outside the modal', () => {
            // jsdom では trap 直後の activeElement は body（集合外＝外側起点と等価）。
            // focusin 再捕捉を経由せず keydown 経路だけを検証するため .focus() は使わない。
            const modal = document.getElementById('modal') as HTMLElement;
            const outside = document.getElementById('outside') as HTMLElement;
            manager.trap(modal);
            expect(document.activeElement).not.toBe(document.getElementById('btn1'));

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            outside.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(document.getElementById('btn1'));
        });

        test('recaptures focus into the modal on focusin from outside', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const outside = document.getElementById('outside') as HTMLElement;
            manager.trap(modal);

            outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

            expect(document.activeElement).toBe(document.getElementById('btn1'));
        });

        test('only the topmost trap answers Escape when two traps are live', () => {
            document.body.innerHTML = `
                <div id="modal1"><button id="m1btn">M1</button></div>
                <div id="modal2"><button id="m2btn">M2</button></div>
                <button id="outside">Outside</button>
            `;
            const close1 = vi.fn();
            const close2 = vi.fn();
            const id1 = manager.trap(document.getElementById('modal1') as HTMLElement, close1);
            manager.trap(document.getElementById('modal2') as HTMLElement, close2);

            document.getElementById('outside')!.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );

            expect(close2).toHaveBeenCalledTimes(1);
            expect(close1).not.toHaveBeenCalled();

            manager.release(id1);
        });
    });
});

    describe('disabled element handling (PBI 2026-10-11-07)', () => {
        // Disabled controls cannot take focus, so keeping them in the set made
        // the Tab wrap-around condition (`activeElement === last`) unreachable
        // and let Tab escape an aria-modal dialog.
        test('excludes disabled controls from the focusable set', () => {
            document.body.innerHTML = `
                <div id="modal">
                    <button id="disabled1" disabled>Disabled</button>
                    <button id="enabled1">Enabled</button>
                </div>
            `;
            const modal = document.getElementById('modal') as HTMLElement;

            expect(getFocusableElements(modal).map((el) => el.id)).toEqual(['enabled1']);
        });

        test('keeps focus inside the modal after the last element becomes disabled', () => {
            document.body.innerHTML = `
                <div id="modal">
                    <button id="first">First</button>
                    <button id="last">Last</button>
                </div>
            `;
            const modal = document.getElementById('modal') as HTMLElement;
            const first = document.getElementById('first') as HTMLElement;
            const last = document.getElementById('last') as HTMLButtonElement;

            manager.trap(modal);
            // Save-in-progress path (masterPassword.ts): the last control is
            // disabled after the trap was installed.
            last.disabled = true;
            first.focus();

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            modal.dispatchEvent(event);

            // `first` is now the only focusable element, so the cycle must wrap
            // (preventDefault) instead of letting Tab leave the dialog.
            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(first);
        });
    });

    describe('focusTrapManager シングルトン', () => {
        test('is a FocusTrapManager instance', () => {
            expect(focusTrapManager).toBeInstanceOf(FocusTrapManager);
        });
    });

    describe('trapFocus', () => {
        test('delegates to focusTrapManager.trap', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const trapId = trapFocus(modal);

            expect(trapId).toMatch(/^focusTrap_/);
            expect(focusTrapManager.handlers.has(trapId)).toBe(true);

            focusTrapManager.release(trapId);
        });
    });

    describe('releaseFocusTrap', () => {
        test('releases the trap from the element', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const trapId = trapFocus(modal);

            releaseFocusTrap(modal);

            expect(focusTrapManager.handlers.has(trapId)).toBe(false);
        });

        test('is a no-op when no matching trap exists', () => {
            const div = document.createElement('div');
            expect(() => releaseFocusTrap(div)).not.toThrow();
        });
    });
});
