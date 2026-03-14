/**
 * contentCleaner.test.ts
 * contentCleaner.ts の単体テスト
 */

// Web Crypto API polyfill テスト環境セットアップ
import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

// jsdom 環境設定
import { JSDOM } from 'jsdom';

describe('contentCleaner', () => {
    let dom: JSDOM;
    let document: Document;

    beforeEach(() => {
        dom = new JSDOM(`
            <html>
                <body>
                    <div id="test-container">
                        <h1>Test Content</h1>
                        <p>This is a test paragraph.</p>

                        <!-- Hard Strip targets: tags -->
                        <form id="login-form">
                            <input type="text" id="username" value="user123">
                            <input type="password" id="password" value="secret123">
                            <textarea id="message">Secret message</textarea>
                            <button type="submit">Login</button>
                        </form>

                        <select id="language">
                            <option value="en">English</option>
                            <option value="ja">Japanese</option>
                        </select>

                        <!-- Hard Strip targets: attributes -->
                        <input type="hidden" id="csrf-token" value="abc123">
                        <input type="text" id="search-field" autocomplete="on">

                        <!-- Hard Strip targets: other tags -->
                        <script>console.log('script');</script>
                        <style>.test { color: red; }</style>
                        <iframe src="ads.html"></iframe>
                        <canvas id="chart"></canvas>
                        <embed src="plugin.swf">
                        <object data="media.swf"></object>
                        <audio src="audio.mp3"></audio>
                        <video src="video.mp4"></video>

                        <!-- Hard Strip targets: additional attributes -->
                        <input type="file" id="file-upload">
                        <input type="email" id="email-input">
                        <input type="tel" id="tel-input">

                        <!-- Keyword Strip targets -->
                        <div id="account-balance">Your balance is $1000</div>
                        <div class="meisai-list">Transaction details</div>
                        <div id="login-container">Login form</div>
                        <div class="card-number-input">
                            <input type="text" placeholder="Card number">
                        </div>
                        <div id="keiyaku-info">
                            <p>Contract information</p>
                        </div>

                        <!-- Non-target content -->
                        <div id="normal-content">
                            <p>This is normal content that should not be removed.</p>
                        </div>
                    </div>
                </body>
            </html>
        `);
        document = dom.window.document;
    });

    afterEach(() => {
        dom.window.close();
    });

    describe('stripHardStripElements', () => {
        it('should remove input tags', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripHardStripElements(container);

            expect(removed).toBeGreaterThan(0);
            expect(container.querySelector('input')).toBeNull();
        });

        it('should remove textarea and select tags', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripHardStripElements(container);

            expect(removed).toBeGreaterThan(0);
            expect(container.querySelector('textarea')).toBeNull();
            expect(container.querySelector('select')).toBeNull();
        });

        it('should remove button tags', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripHardStripElements(container);

            expect(removed).toBeGreaterThan(0);
            expect(container.querySelector('button')).toBeNull();
        });

        it('should remove form tags', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripHardStripElements(container);

            const form = container.querySelector('form');
            expect(form?.id).not.toBe('login-form');
        });

        it('should remove script, style, iframe, canvas, embed, object, audio, video tags', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripHardStripElements(container);

            expect(removed).toBeGreaterThan(0);
            expect(container.querySelector('script')).toBeNull();
            expect(container.querySelector('style')).toBeNull();
            expect(container.querySelector('iframe')).toBeNull();
            expect(container.querySelector('canvas')).toBeNull();
            expect(container.querySelector('embed')).toBeNull();
            expect(container.querySelector('object')).toBeNull();
            expect(container.querySelector('audio')).toBeNull();
            expect(container.querySelector('video')).toBeNull();
        });

        it('should remove elements with type="password" attribute', () => {
            const container = document.getElementById('test-container')!;
            const passwordInput = container.querySelector('#password');
            expect(passwordInput).not.toBeNull();

            stripHardStripElements(container);

            const passwordInputAfter = container.querySelector('#password');
            expect(passwordInputAfter).toBeNull();
        });

        it('should remove elements with type="hidden" attribute', () => {
            const container = document.getElementById('test-container')!;
            const hiddenInput = container.querySelector('#csrf-token');
            expect(hiddenInput).not.toBeNull();

            stripHardStripElements(container);

            const hiddenInputAfter = container.querySelector('#csrf-token');
            expect(hiddenInputAfter).toBeNull();
        });

        it('should remove elements with autocomplete attribute', () => {
            const container = document.getElementById('test-container')!;
            const autocompleteInput = container.querySelector('#search-field');
            expect(autocompleteInput).not.toBeNull();

            stripHardStripElements(container);

            const autocompleteInputAfter = container.querySelector('#search-field');
            expect(autocompleteInputAfter).toBeNull();
        });

        it('should remove elements with type="file" attribute', () => {
            const container = document.getElementById('test-container')!;
            const fileInput = container.querySelector('#file-upload');
            expect(fileInput).not.toBeNull();

            stripHardStripElements(container);

            const fileInputAfter = container.querySelector('#file-upload');
            expect(fileInputAfter).toBeNull();
        });

        it('should remove elements with type="email" attribute', () => {
            const container = document.getElementById('test-container')!;
            const emailInput = container.querySelector('#email-input');
            expect(emailInput).not.toBeNull();

            stripHardStripElements(container);

            const emailInputAfter = container.querySelector('#email-input');
            expect(emailInputAfter).toBeNull();
        });

        it('should remove elements with type="tel" attribute', () => {
            const container = document.getElementById('test-container')!;
            const telInput = container.querySelector('#tel-input');
            expect(telInput).not.toBeNull();

            stripHardStripElements(container);

            const telInputAfter = container.querySelector('#tel-input');
            expect(telInputAfter).toBeNull();
        });

        it('should not remove normal content', () => {
            const container = document.getElementById('test-container')!;
            stripHardStripElements(container);

            const h1 = container.querySelector('h1');
            const p = container.querySelector('p');
            const normalContent = container.querySelector('#normal-content');

            expect(h1).not.toBeNull();
            expect(p).not.toBeNull();
            expect(normalContent).not.toBeNull();
        });
    });

    describe('stripKeywordElements', () => {
        it('should remove elements with ID containing "balance"', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['balance']);

            expect(removed).toBe(1);
            const balanceDiv = container.querySelector('#account-balance');
            expect(balanceDiv).toBeNull();
        });

        it('should remove elements with class containing "meisai"', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['meisai']);

            expect(removed).toBe(1);
            const meisaiDiv = container.querySelector('.meisai-list');
            expect(meisaiDiv).toBeNull();
        });

        it('should remove elements with ID containing "login"', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['login']);

            // loginForm と loginContainer の2つが削除される
            expect(removed).toBe(2);
            const loginDiv = container.querySelector('#login-container');
            expect(loginDiv).toBeNull();
        });

        it('should remove elements with class containing "card-number"', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['card-number']);

            expect(removed).toBe(1);
            const cardNumberDiv = container.querySelector('.card-number-input');
            expect(cardNumberDiv).toBeNull();
        });

        it('should remove elements with ID containing "keiyaku"', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['keiyaku']);

            expect(removed).toBe(1);
            const keiyakuDiv = container.querySelector('#keiyaku-info');
            expect(keiyakuDiv).toBeNull();
        });

        it('should remove multiple elements matching keywords', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, [
                'balance',
                'meisai',
                'login',
                'card-number',
                'keiyaku'
            ]);

            // 6つの要素が削除されるはず（balance=1, meisai=1, login=2, card-number=1, keiyaku=1）
            expect(removed).toBe(6);
        });

        it('should be case-insensitive', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['BALANCE']);

            // 大文字でも削除される
            expect(removed).toBe(1);
            const balanceDiv = container.querySelector('#account-balance');
            expect(balanceDiv).toBeNull();
        });

        it('should not remove elements without matching keywords', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, ['nonexistent']);

            expect(removed).toBe(0);
            const normalContent = container.querySelector('#normal-content');
            expect(normalContent).not.toBeNull();
        });

        it('should handle empty keywords array', () => {
            const container = document.getElementById('test-container')!;
            const removed = stripKeywordElements(container, []);

            expect(removed).toBe(0);
        });

        it('should handle null or undefined keywords', () => {
            const container = document.getElementById('test-container')!;

            const removed1 = stripKeywordElements(container, null as any);
            expect(removed1).toBe(0);

            const removed2 = stripKeywordElements(container, undefined as any);
            expect(removed2).toBe(0);
        });
    });

    describe('cleanseContent', () => {
        it('should perform both Hard Strip and Keyword Strip when both enabled', () => {
            const container = document.getElementById('test-container')!;
            const result = cleanseContent(container, {
                hardStripEnabled: true,
                keywordStripEnabled: true,
                keywords: ['balance', 'meisai', 'login', 'card-number', 'keiyaku']
            });

            expect(result.hardStripRemoved).toBeGreaterThan(0);
            expect(result.keywordStripRemoved).toBeGreaterThan(0);
            expect(result.totalRemoved).toBe(result.hardStripRemoved + result.keywordStripRemoved);
        });

        it('should only perform Hard Strip when Keyword Strip disabled', () => {
            const container = document.getElementById('test-container')!;
            const result = cleanseContent(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            expect(result.hardStripRemoved).toBeGreaterThan(0);
            expect(result.keywordStripRemoved).toBe(0);
        });

        it('should only perform Keyword Strip when Hard Strip disabled', () => {
            const container = document.getElementById('test-container')!;
            const result = cleanseContent(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true,
                keywords: ['balance']
            });

            expect(result.hardStripRemoved).toBe(0);
            expect(result.keywordStripRemoved).toBeGreaterThan(0);
        });

        it('should use default keywords when not specified', () => {
            const container = document.getElementById('test-container')!;
            const result = cleanseContent(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true
            });

            // デフォルトキーワードに含まれるものが削除される
            expect(result.keywordStripRemoved).toBeGreaterThan(0);
        });

        it('should return zero when both disabled', () => {
            const container = document.getElementById('test-container')!;
            const result = cleanseContent(container, {
                hardStripEnabled: false,
                keywordStripEnabled: false
            });

            expect(result.totalRemoved).toBe(0);
        });
    });

    describe('Performance with many keywords', () => {
        it('should handle 20+ keywords efficiently', () => {
            // 20個のキーワードを生成
            const keywords = Array.from({ length: 20 }, (_, i) => `keyword${i}`);

            // テスト用DOMを作成（各キーワードに対応する要素を含む）
            const testDom = new JSDOM(`
                <html>
                    <body>
                        <div id="test-container">
                            ${keywords.map((kw, i) => `
                                <div id="${kw}-element">Element ${i}</div>
                                <div class="${kw}-class">Class Element ${i}</div>
                            `).join('')}
                        </div>
                    </body>
                </html>
            `);
            const testDocument = testDom.window.document;
            const container = testDocument.getElementById('test-container')!;

            // パフォーマンス計測
            const startTime = performance.now();
            const result = stripKeywordElements(container, keywords);
            const endTime = performance.now();
            const duration = endTime - startTime;

            // 40個の要素が削除されるはず（各キーワードにつきIDとClassの2つ）
            expect(result).toBe(40);

            // パフォーマンス要件: 100ms以内で完了すること
            expect(duration).toBeLessThan(100);

            testDom.window.close();
        });

        it('should handle 50+ keywords efficiently', () => {
            // 50個のキーワードを生成
            const keywords = Array.from({ length: 50 }, (_, i) => `keyword${i}`);

            // テスト用DOMを作成（各キーワードに対応する要素を含む）
            const testDom = new JSDOM(`
                <html>
                    <body>
                        <div id="test-container">
                            ${keywords.map((kw, i) => `
                                <div id="${kw}-element">Element ${i}</div>
                                <div class="${kw}-class">Class Element ${i}</div>
                            `).join('')}
                        </div>
                    </body>
                </html>
            `);
            const testDocument = testDom.window.document;
            const container = testDocument.getElementById('test-container')!;

            // パフォーマンス計測
            const startTime = performance.now();
            const result = stripKeywordElements(container, keywords);
            const endTime = performance.now();
            const duration = endTime - startTime;

            // 100個の要素が削除されるはず（各キーワードにつきIDとClassの2つ）
            expect(result).toBe(100);

            // パフォーマンス要件: 200ms以内で完了すること
            expect(duration).toBeLessThan(200);

            testDom.window.close();
        });

        it('should handle keywords with special characters', () => {
            // 特殊文字を含むキーワード
            const keywords = ['test"quote', 'test\'apostrophe', 'test[bracket]', 'test\\backslash'];

            // テスト用DOMを作成
            const testDom = new JSDOM(`
                <html>
                    <body>
                        <div id="test-container">
                            <div id="test&quot;quote-element">Element 1</div>
                            <div id="test&#39;apostrophe-element">Element 2</div>
                            <div id="test[bracket]-element">Element 3</div>
                            <div id="test\\backslash-element">Element 4</div>
                        </div>
                    </body>
                </html>
            `);
            const testDocument = testDom.window.document;
            const container = testDocument.getElementById('test-container')!;

            // DOMExceptionがスローされずに正常に動作することを確認
            expect(() => {
                stripKeywordElements(container, keywords);
            }).not.toThrow();

            testDom.window.close();
        });
    });
});

// contentCleaner 関数をインポート
import {
    stripHardStripElements,
    stripKeywordElements,
    cleanseContent
} from '../contentCleaner';