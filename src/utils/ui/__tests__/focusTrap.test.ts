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
    releaseFocusTrap
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

            test('returns a trap ID when no focusable elements exist', () => {
                document.body.innerHTML = '<div id="empty-modal"></div>';
                const trapId = manager.trap('#empty-modal');

                expect(trapId).toMatch(/^focusTrap_/);
                // フォーカス可能な要素がないのでハンドラは登録されない
                expect(manager.handlers.has(trapId)).toBe(false);
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

            expect(id1).toMatch(/^focusTrap_\d+_[a-z0-9]+$/);
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
