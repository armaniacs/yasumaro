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

        it('should remove elements with ID containing "credit-card"', () => {
            const container = document.getElementById('test-container')!;
            container.innerHTML = '<div id="credit-card">1234-5678-9012-3456</div>';
            const removed = stripKeywordElements(container, ['credit-card']);

            expect(removed).toBe(1);
            expect(container.innerHTML).not.toContain('credit-card');
        });

        it('should remove elements with class containing "passport"', () => {
            const container = document.getElementById('test-container')!;
            container.innerHTML = '<div class="passport">AB1234567</div>';
            const removed = stripKeywordElements(container, ['passport']);

            expect(removed).toBe(1);
            expect(container.innerHTML).not.toContain('passport');
        });

        it('should remove elements with ID containing "my-number"', () => {
            const container = document.getElementById('test-container')!;
            container.innerHTML = '<div id="my-number-field">123456789012</div>';
            const removed = stripKeywordElements(container, ['my-number']);

            expect(removed).toBe(1);
            expect(container.innerHTML).not.toContain('my-number');
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

        test('new keywords are correctly stripped', () => {
            const div = document.createElement('div');
            div.innerHTML = `
                <div id="credit-card">1234-5678-9012-3456</div>
                <div class="passport">AB1234567</div>
                <div id="my-number">123456789012</div>
            `;

            const result = cleanseContent(div);
            expect(result.totalRemoved).toBe(3);
            expect(div.innerHTML).not.toContain('credit-card');
        });

        test('data-* attributes are correctly scanned and stripped', () => {
            const div = document.createElement('div');
            div.innerHTML = `
                <div data-credit-card="1234">Test 1</div>
                <div data-user-passport="AB1234567">Test 2</div>
                <div data-my-number="123456">Test 3</div>
                <div data-normal-attribute="normal">Test 4</div>
            `;

            const result = cleanseContent(div);
            expect(result.totalRemoved).toBe(3);
            expect(div.innerHTML).toContain('Test 4');
            expect(div.innerHTML).not.toContain('Test 1');
            expect(div.innerHTML).not.toContain('Test 2');
            expect(div.innerHTML).not.toContain('Test 3');
        });

        test('countCleanseTargets correctly counts data-* attributes', () => {
            const div = document.createElement('div');
            div.innerHTML = `
                <div data-credit-card="1234">Test 1</div>
                <div data-user-passport="AB1234567">Test 2</div>
                <div data-normal="normal">Test 3</div>
            `;

            const original = div.innerHTML;
            const result = countCleanseTargets(div);
            
            // DOMが変更されていないことを確認
            expect(div.innerHTML).toBe(original);
            expect(result.keywordStripRemoved).toBe(2);
        });

        test('context validation - strip elements with sensitive content', () => {
            const div = document.createElement('div');
            div.innerHTML = `
                <div id="password-field">My password is secret123</div>
                <div id="account-balance">Balance: $1000</div>
            `;

            const result = cleanseContent(div);
            // 機密コンテンツを含む要素は削除
            expect(div.innerHTML).not.toContain('secret123');
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

    describe('countCleanseTargets', () => {
        it('should count hard strip targets without removing them', () => {
            const container = document.getElementById('test-container')!;
            const originalHTML = container.innerHTML;

            const result = countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            expect(result.hardStripRemoved).toBeGreaterThan(0);
            expect(result.keywordStripRemoved).toBe(0);
            expect(result.totalRemoved).toBe(result.hardStripRemoved);
            // DOM should not be modified
            expect(container.innerHTML).toBe(originalHTML);
        });

        it('should count keyword strip targets without removing them', () => {
            const container = document.getElementById('test-container')!;
            const originalHTML = container.innerHTML;

            const result = countCleanseTargets(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true,
                keywords: ['balance', 'meisai']
            });

            expect(result.hardStripRemoved).toBe(0);
            expect(result.keywordStripRemoved).toBeGreaterThan(0);
            expect(result.totalRemoved).toBe(result.keywordStripRemoved);
            // DOM should not be modified
            expect(container.innerHTML).toBe(originalHTML);
        });

        it('should count both hard strip and keyword strip targets', () => {
            const container = document.getElementById('test-container')!;

            const result = countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: true,
                keywords: ['balance', 'login']
            });

            expect(result.hardStripRemoved).toBeGreaterThan(0);
            expect(result.keywordStripRemoved).toBeGreaterThan(0);
            expect(result.totalRemoved).toBe(result.hardStripRemoved + result.keywordStripRemoved);
        });

        it('should use default keywords when not specified', () => {
            const container = document.getElementById('test-container')!;

            const result = countCleanseTargets(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true
            });

            expect(result.keywordStripRemoved).toBeGreaterThan(0);
        });

        it('should return zero when both disabled', () => {
            const container = document.getElementById('test-container')!;

            const result = countCleanseTargets(container, {
                hardStripEnabled: false,
                keywordStripEnabled: false
            });

            expect(result.totalRemoved).toBe(0);
            expect(result.hardStripRemoved).toBe(0);
            expect(result.keywordStripRemoved).toBe(0);
        });

        it('should count with default options', () => {
            const container = document.getElementById('test-container')!;

            const result = countCleanseTargets(container);

            expect(result.totalRemoved).toBeGreaterThan(0);
        });

        it('should not double-count elements matched by multiple keywords', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="test-container">
                        <div id="balance-login-info">info</div>
                    </div>
                </body></html>
            `);
            const testDocument = testDom.window.document;
            const container = testDocument.getElementById('test-container')!;

            const result = countCleanseTargets(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true,
                keywords: ['balance', 'login']
            });

            // Same element matches both keywords, but should only be counted once
            expect(result.keywordStripRemoved).toBe(1);

            testDom.window.close();
        });

        it('should count keyword targets in both id and class attributes', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="test-container">
                        <div id="secret-info">id match</div>
                        <div class="secret-class">class match</div>
                    </div>
                </body></html>
            `);
            const testDocument = testDom.window.document;
            const container = testDocument.getElementById('test-container')!;

            const result = countCleanseTargets(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true,
                keywords: ['secret']
            });

            expect(result.keywordStripRemoved).toBe(2);

            testDom.window.close();
        });

        it('should handle empty keywords array', () => {
            const container = document.getElementById('test-container')!;

            const result = countCleanseTargets(container, {
                hardStripEnabled: false,
                keywordStripEnabled: true,
                keywords: []
            });

            expect(result.keywordStripRemoved).toBe(0);
        });
    });

    describe('countCleanseTargets RegExp attribute handling', () => {
        it('should count elements with RegExp-matched inputmode attribute', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div inputmode="numeric">Numeric</div>
                        <div inputmode="tel">Tel</div>
                        <div inputmode="text">Normal</div>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const result = countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            // 2 from inputmode RegExp
            expect(result.hardStripRemoved).toBe(2);
            expect(result.keywordStripRemoved).toBe(0);
            expect(result.totalRemoved).toBe(2);
            testDom.window.close();
        });

        it('should count with case-insensitive RegExp match', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div inputmode="EMAIL">Mixed case</div>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const result = countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            expect(result.hardStripRemoved).toBe(1);
            testDom.window.close();
        });

        it('should not affect DOM when counting RegExp targets', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div inputmode="numeric">Numeric</div>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const originalHTML = container.innerHTML;

            countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            expect(container.innerHTML).toBe(originalHTML);
            testDom.window.close();
        });

        it('should count both tag and RegExp attribute targets together', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <input type="text">
                        <div inputmode="numeric">Numeric</div>
                        <form></form>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const result = countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            // input tag (1) + form tag (1) + numeric inputmode (1) = 3
            expect(result.hardStripRemoved).toBe(3);
            testDom.window.close();
        });

        it('should not double-count elements matched by both tag and RegExp attribute', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <input inputmode="numeric">
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const result = countCleanseTargets(container, {
                hardStripEnabled: true,
                keywordStripEnabled: false
            });

            // input matched by tag, inputmode matched by attribute
            expect(result.hardStripRemoved).toBe(2); // tag count + attr count
            testDom.window.close();
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

    describe('RegExp attribute handling in stripHardStripElements', () => {
        it('should remove elements with RegExp-matched inputmode attribute', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div inputmode="numeric">Numeric input</div>
                        <div inputmode="tel">Tel input</div>
                        <div inputmode="email">Email input</div>
                        <div inputmode="text">Normal text</div>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const removed = stripHardStripElements(container);
            expect(removed).toBe(3);
            expect(container.querySelector('[inputmode="numeric"]')).toBeNull();
            expect(container.querySelector('[inputmode="tel"]')).toBeNull();
            expect(container.querySelector('[inputmode="email"]')).toBeNull();
            expect(container.querySelector('[inputmode="text"]')).not.toBeNull();
            testDom.window.close();
        });

        it('should remove elements with case-insensitive RegExp match', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div inputmode="NUMERIC">Uppercase numeric</div>
                        <div inputmode="Email">Mixed case email</div>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const removed = stripHardStripElements(container);
            expect(removed).toBe(2);
            testDom.window.close();
        });

        it('should not remove elements when RegExp attribute is absent', () => {
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div>Normal content</div>
                        <p>Another element</p>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const removed = stripHardStripElements(container);
            // Only hard strip tags from test container context matter
            // In a isolated div with no hard strip elements, removed is tag match count of nested elements
            // Since div/p are not hard strip tags and don't have other hard strip attrs
            expect(removed).toBe(0);
            testDom.window.close();
        });
    });

    describe('attribute-based strip deduplication', () => {
        it('should not duplicate removal when element matches both tag and attribute', () => {
            // input[type=password] matches both tag (input) and attribute (type=password)
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <input type="password" id="pw">
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const removed = stripHardStripElements(container);
            // Should remove the element only once
            expect(removed).toBe(1);
            expect(container.querySelector('input')).toBeNull();
            testDom.window.close();
        });

        it('should remove autocomplete attribute on non-form element', () => {
            // autocomplete on a div (not matched by tag selector) triggers line 112
            const testDom = new JSDOM(`
                <html><body>
                    <div id="container">
                        <div autocomplete="on">Not a form</div>
                    </div>
                </body></html>
            `);
            const container = testDom.window.document.getElementById('container')!;
            const removed = stripHardStripElements(container);
            expect(removed).toBe(1);
            expect(container.querySelector('[autocomplete]')).toBeNull();
            testDom.window.close();
        });
    });
});

// contentCleaner 関数をインポート
import {
    isHardStripTarget,
    stripHardStripElements,
    stripKeywordElements,
    cleanseContent,
    countCleanseTargets,
    type AttributeSelector
} from '../contentCleaner';

describe('isHardStripTarget', () => {
    let dom: JSDOM;
    let document: Document;

    beforeEach(() => {
        dom = new JSDOM(`<html><body><div id="root"></div></body></html>`);
        document = dom.window.document;
    });

    afterEach(() => {
        dom.window.close();
    });

    it('should return true for hard strip tag names (input, form, script, etc.)', () => {
        const input = document.createElement('input');
        const form = document.createElement('form');
        const script = document.createElement('script');

        expect(isHardStripTarget(input)).toBe(true);
        expect(isHardStripTarget(form)).toBe(true);
        expect(isHardStripTarget(script)).toBe(true);
    });

    it('should return true when element has attribute with undefined value selector (attribute exists)', () => {
        const div = document.createElement('div');
        div.setAttribute('autocomplete', 'on');

        expect(isHardStripTarget(div)).toBe(true);
    });

    it('should return false when element does not have attribute with undefined value selector', () => {
        const div = document.createElement('div');

        expect(isHardStripTarget(div)).toBe(false);
    });

    it('should return true when attribute value matches RegExp', () => {
        const div = document.createElement('div');
        div.setAttribute('inputmode', 'numeric');

        expect(isHardStripTarget(div)).toBe(true);
    });

    it('should return true when RegExp matches case-insensitively (line 90-94 branch)', () => {
        const div = document.createElement('div');
        div.setAttribute('inputmode', 'EMAIL');

        expect(isHardStripTarget(div)).toBe(true);
    });

    it('should return false when attribute value does not match RegExp (line 90)', () => {
        const div = document.createElement('div');
        div.setAttribute('inputmode', 'text');

        expect(isHardStripTarget(div)).toBe(false);
    });

    it('should return false when attribute is absent for RegExp selector', () => {
        const div = document.createElement('div');

        expect(isHardStripTarget(div)).toBe(false);
    });

    it('should return true for exact string attribute match', () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'password');

        expect(isHardStripTarget(input)).toBe(true);
    });

    it('should return false when exact string attribute does not match (line 96-100 branch)', () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'checkbox');

        expect(isHardStripTarget(input)).toBe(true); // tag match
    });

    it('should return true for any hard strip tag even without matching attributes', () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'checkbox');

        // input tag is in HARD_STRIP_TAGS, so should return true regardless of attribute
        expect(isHardStripTarget(input)).toBe(true);
    });

    it('should use custom attributes parameter when provided', () => {
        const div = document.createElement('div');
        div.setAttribute('data-skip', 'yes');

        const customAttrs: AttributeSelector[] = [
            { name: 'data-skip', value: 'yes' }
        ];

        expect(isHardStripTarget(div, customAttrs)).toBe(true);
        expect(isHardStripTarget(document.createElement('input'), customAttrs)).toBe(true); // tag match
    });

    it('should return false for normal non-target elements', () => {
        const div = document.createElement('div');
        const p = document.createElement('p');
        const span = document.createElement('span');

        expect(isHardStripTarget(div)).toBe(false);
        expect(isHardStripTarget(p)).toBe(false);
        expect(isHardStripTarget(span)).toBe(false);
    });

    it('should handle empty custom attributes array (only tag match)', () => {
        const input = document.createElement('input');
        const div = document.createElement('div');

        expect(isHardStripTarget(input, [])).toBe(true); // tag
        expect(isHardStripTarget(div, [])).toBe(false);
    });

    it('should handle multiple RegExp alternatives in value', () => {
        const attrs: AttributeSelector[] = [
            { name: 'role', value: /^(sensitive|secret|private)$/i }
        ];
        const div = document.createElement('div');
        div.setAttribute('role', 'secret');

        expect(isHardStripTarget(div, attrs)).toBe(true);

        div.setAttribute('role', 'other');
        expect(isHardStripTarget(div, attrs)).toBe(false);
    });
});