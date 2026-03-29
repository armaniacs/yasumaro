/**
 * focusTrap.test.ts
 * focusTrap.ts の単体テスト
 */

import { JSDOM } from 'jsdom';

// jsdom 環境で document を使用
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: 'http://localhost' });
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;

import {
    FocusTrapManager,
    focusTrapManager,
    trapFocus,
    releaseFocusTrap
} from '../utils/focusTrap.js';

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
        test('初期状態でハンドラが空', () => {
            expect(manager.handlers.size).toBe(0);
            expect(manager.previousFocus.size).toBe(0);
        });

        describe('trap', () => {
            test('HTMLElement を受け付ける', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                const trapId = manager.trap(modal);

                expect(trapId).toMatch(/^focusTrap_/);
                expect(manager.handlers.has(trapId)).toBe(true);
            });

            test('文字列セレクタを受け付ける', () => {
                const trapId = manager.trap('#modal');

                expect(trapId).toMatch(/^focusTrap_/);
                expect(manager.handlers.has(trapId)).toBe(true);
            });

            test('存在しないセレクタでエラーを投げる', () => {
                expect(() => manager.trap('#nonexistent')).toThrow('Modal element not found');
            });

            test('フォーカス可能な要素がない場合はトラップIDを返す', () => {
                document.body.innerHTML = '<div id="empty-modal"></div>';
                const trapId = manager.trap('#empty-modal');

                expect(trapId).toMatch(/^focusTrap_/);
                // フォーカス可能な要素がないのでハンドラは登録されない
                expect(manager.handlers.has(trapId)).toBe(false);
            });

            test('毎回異なるトラップIDを生成する', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                const id1 = manager.trap(modal);
                const id2 = manager.trap(modal);

                expect(id1).not.toBe(id2);
            });
        });

        describe('release', () => {
            test('トラップを解放する', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                const trapId = manager.trap(modal);

                manager.release(trapId);

                expect(manager.handlers.has(trapId)).toBe(false);
                expect(manager.previousFocus.has(trapId)).toBe(false);
            });

            test('存在しないトラップIDでもno-op', () => {
                expect(() => manager.release('nonexistent')).not.toThrow();
            });
        });

        describe('releaseAll', () => {
            test('全てのトラップを解放する', () => {
                const modal = document.getElementById('modal') as HTMLElement;
                manager.trap(modal);
                manager.trap(modal);

                expect(manager.handlers.size).toBe(2);

                manager.releaseAll();

                expect(manager.handlers.size).toBe(0);
                expect(manager.previousFocus.size).toBe(0);
            });

            test('トラップがない場合でもno-op', () => {
                expect(() => manager.releaseAll()).not.toThrow();
            });
        });

        describe('generateId', () => {
            test('一意のIDを生成する', () => {
                const id1 = manager.generateId();
                const id2 = manager.generateId();

                expect(id1).toMatch(/^focusTrap_\d+_[a-z0-9]+$/);
                expect(id1).not.toBe(id2);
            });
        });
    });

    describe('focusTrapManager シングルトン', () => {
        test('FocusTrapManager のインスタンス', () => {
            expect(focusTrapManager).toBeInstanceOf(FocusTrapManager);
        });
    });

    describe('trapFocus', () => {
        test('focusTrapManager.trap を委譲する', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const trapId = trapFocus(modal);

            expect(trapId).toMatch(/^focusTrap_/);
            expect(focusTrapManager.handlers.has(trapId)).toBe(true);

            focusTrapManager.release(trapId);
        });
    });

    describe('releaseFocusTrap', () => {
        test('要素からトラップを解放する', () => {
            const modal = document.getElementById('modal') as HTMLElement;
            const trapId = trapFocus(modal);

            releaseFocusTrap(modal);

            expect(focusTrapManager.handlers.has(trapId)).toBe(false);
        });

        test('対応するトラップがない場合はno-op', () => {
            const div = document.createElement('div');
            expect(() => releaseFocusTrap(div)).not.toThrow();
        });
    });
});
