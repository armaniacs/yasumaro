# アクセシビリティガイド / Accessibility Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Obsidian Smart Historyは、WCAG 2.1 Level AAのアクセシビリティ標準への準拠を目指しています。このガイドでは、実装されているアクセシビリティ機能と、コントリビューション時のガイドラインについて説明します。

### WCAG 2.1 Level AA コンプライアンス

本拡張機能は、以下のWCAG 2.1 Level AA基準を満たすよう設計されています：

| 原則 | 項目 | 状態 | 説明 |
|------|------|------|------|
| を知覚できる | 対比最低限 | ✅ | テキストの対比比は4.5:1以上、大文字太字は3:1以上 |
| を知覚できる | レイアウト変更なし | ✅ | フォントサイズや拡大/縮小によりレイアウトが変わらない |
| 操作可能 | キーボードアクセシビリティ | ✅ | 全機能がキーボード操作可能 |
| 操作可能 | 十分な時間 | ✅ | 制限時間なし、重要なタイムアウトなし |
| 理解可能 | 識別可能 | ✅ | コンポーネントはラベルで識別可能 |
| 堅牢性 | 互換性 | ✅ | スクリーンリーダー等の支援技術との互換性 |

### 実装済みのアクセシビリティ機能

#### 1. Focus Trap Manager（フォーカストラップ）

モーダルダイアログ内でフォーカスを閉じ込める機能です。

**使用方法:**

```javascript
import { focusTrapManager } from './utils/focusTrap.js';

// モーダルを開くときにフォーカストラップを有効化
const trapId = focusTrapManager.trap(modalElement, () => {
  // 閉じるコールバック（ESCキー押下時に実行）
  closeModal();
});

// モーダルを閉じる時にフォーカストラップを解放
focusTrapManager.release(trapId);
```

**動作:**
- TAB/Shift+TABでモーダル内のフォーカス可能な要素間でフォーカス移動
- ESCキーで `closeCallback` を実行
- モーダルが開いている間は、背景要素へのフォーカス移動を防止

**実装箇所:**
- `src/popup/utils/focusTrap.js`

#### 2. ARIA属性

**ラベル付きのUI要素:**

```html
<!-- アイコンボタン -->
<button class="icon-btn"
        data-i18n-aria-label="settings">
  ⚙
</button>

<!-- ドロップゾーン -->
<div id="uBlockDropZone"
     class="drop-zone"
     role="region"
     data-i18n-aria-label="dropZoneLabel">
  <p data-i18n="dropFileHere">Drop file here</p>
</div>
```

**ラジオグループ:**

```html<div class="radio-group"
     role="radiogroup"
     aria-labelledby="domainFilterModeLabel">
  <label id="domainFilterModeLabel" data-i18n="domainFilterMode">
    Domain Filter Mode
  </label>

  <div>
    <input type="radio" id="modeA"
           name="privacyMode"
           value="local_only"
           aria-describedby="modeADesc">
    <label for="modeA" data-i18n="modeA">Mode A</label>
    <div class="help-text" id="modeADesc" data-i18n="modeADesc">
      サービス説明
    </div>
  </div>
</div>
```

**動的コンテンツ:**

```html
<!-- ステータスメッセージ -->
<div id="status" aria-live="polite"></div>

<!-- アラートエラー -->
<div role="alert" class="error-message">
  エラー内容
</div>
```

#### 3. タブナビゲーション

設定画面のタブ切り替え時のフォーカス管理：

```javascript
function showTab(tabName) {
  // パネルの切り替え...

  // 新しくアクティブになったパネルの最初のフォーカス可能要素にフォーカス
  const activePanel = /* ... */;
  const firstFocusable = activePanel.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (firstFocusable) {
    firstFocusable.focus();
  }
}
```

**キーボードショートカット:**
- `Tab`: 次のフォーカス可能要素へ
- `Shift+Tab`: 前のフォーカス可能要素へ
- `Right/Left`: タブ間の移動
- `Home/End`: 最初/最後のタブへ
- `Enter`/`Space`: タブを選択

#### 4. 色のコントラスト

ダークモードでの色コントラスト改善：

| 要素 | 旧色 | 新色 | 対比比 | 結果 |
|------|------|------|--------|------|
| アクセント色 | `#FF9800` | `#FFB74D` | ~4.5:1 | ✅ AA準拠 |
| セカンダリ色 | `#6c757d` | `#9E9E9E` | ~6.3:1 | ✅ AAA準拠 |
| プライマリボタン | `#66BB6A` | `#43A047` | ~4.5:1 | ✅ AA準拠 |

実装箇所: `src/popup/styles.css`

### テストチェックリスト

新しいUI機能を追加する際は、以下のチェックリストを使用してください：

#### キーボードアクセシビリティ

- [ ] 全ての対話可能要素がキーボード (`Tab`, `Enter`, `Esc` など) で操作できる
- [ ] フォーカス順序が視覚的な順序と一致している
- [ ] フォーカスインジケーターが明確に見える
- [ ] モーダルやドラッグ操作で `Esc` キーでキャンセルできる

#### スクリーンリーダー

- [ ] 全てのボタンとリンクにラベルがある
- [ ] アイコンのみのボタンに `aria-label` が付いている
- [ ] フォーム要素が適切にラベル付けされている
- [ ] エラーメッセージがスクリーンリーダーで読み上げられる
- [ ] 動的コンテンツに `aria-live` を使用している

#### 色と視覚

- [ ] 色のみで情報を伝えていない（テキストも併用）
- [ ] テキストと背景の対比比が最低4.5:1以上
- [ ] フォームの必須項目、エラー、成功状態が明確に識別できる

#### モーダルとフォーカストラップ

- [ ] モーダルを開くとフォーカスがモーダル内に移動する
- [ ] モーダル内で `Tab` を押してもフォーカスがモーダル外に出ない
- [ ] `Esc` でモーダルが閉じる
- [ ] モーダルを閉じるとフォーカスが開く前の要素に戻る

### 推奨されるテストツール

- [Lighthouse](https://developers.google.com/web/tools/lighthouse) - Chrome DevTools統合
- [axe DevTools](https://www.deque.com/axe/devtools/) - 自動アクセシビリティテスト
- [WAVE](https://wave.webaim.org/) - WebAIMの評価ツール
- スクリーンリーダー（NVDA, JAWS, VoiceOver）

---

## English

### Overview

Obsidian Smart History aims to comply with WCAG 2.1 Level AA accessibility standards. This guide covers implemented accessibility features and guidelines for contributions.

### WCAG 2.1 Level AA Compliance

This extension is designed to meet the following WCAG 2.1 Level AA criteria:

| Principle | Criterion | Status | Description |
|-----------|----------|--------|-------------|
| Perceivable | Contrast Minimum | ✅ | Text contrast ratio ≥4.5:1, large bold text ≥3:1 |
| Perceivable | Reflow | ✅ | Zoom/resize doesn't change layout |
| Operable | Keyboard Accessibility | ✅ | All functions accessible via keyboard |
| Operable | Enough Time | ✅ | No time limits, no important timeouts |
| Understandable | Identifiable | ✅ | Components labeled and identifiable |
| Robust | Compatible | ✅ | Compatible with assistive technologies |

### Implemented Accessibility Features

#### 1. Focus Trap Manager

Keeps focus within modal dialogs.

**Usage:**

```javascript
import { focusTrapManager } from './utils/focusTrap.js';

// Enable focus trap when opening modal
const trapId = focusTrapManager.trap(modalElement, () => {
  // Close callback (executed on ESC key)
  closeModal();
});

// Release focus trap when closing modal
focusTrapManager.release(trapId);
```

**Behavior:**
- TAB/Shift+TAB moves focus between focusable elements within modal
- ESC key executes `closeCallback`
- Prevents focus from escaping to background elements

**Location:** `src/popup/utils/focusTrap.js`

#### 2. ARIA Attributes

**Labeled UI Elements:**

```html
<!-- Icon button -->
<button class="icon-btn"
        data-i18n-aria-label="settings">
  ⚙
</button>

<!-- Drop zone -->
<div id="uBlockDropZone"
     class="drop-zone"
     role="region"
     data-i18n-aria-label="dropZoneLabel">
  <p data-i18n="dropFileHere">Drop file here</p>
</div>
```

**Radio Groups:**

```html
<div class="radio-group"
     role="radiogroup"
     aria-labelledby="domainFilterModeLabel">
  <label id="domainFilterModeLabel" data-i18n="domainFilterMode">
    Domain Filter Mode
  </label>

  <div>
    <input type="radio" id="modeA"
           name="privacyMode"
           value="local_only"
           aria-describedby="modeADesc">
    <label for="modeA" data-i18n="modeA">Mode A</label>
    <div class="help-text" id="modeADesc" data-i18n="modeADesc">
      Service description
    </div>
  </div>
</div>
```

**Dynamic Content:**

```html
<!-- Status messages -->
<div id="status" aria-live="polite"></div>

<!-- Alert errors -->
<div role="alert" class="error-message">
  Error message
</div>
```

#### 3. Tab Navigation

Focus management when switching settings tabs:

```javascript
function showTab(tabName) {
  // Toggle panels...

  // Focus first focusable element in newly activated panel
  const activePanel = /* ... */;
  const firstFocusable = activePanel.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (firstFocusable) {
    firstFocusable.focus();
  }
}
```

**Keyboard Shortcuts:**
- `Tab`: Move to next focusable element
- `Shift+Tab`: Move to previous focusable element
- `Right/Left`: Navigate between tabs
- `Home/End`: Jump to first/last tab
- `Enter`/`Space`: Select tab

#### 4. Color Contrast

Dark mode color contrast improvements:

| Element | Old Color | New Color | Contrast Ratio | Result |
|---------|-----------|-----------|----------------|--------|
| Accent color | `#FF9800` | `#FFB74D` | ~4.5:1 | ✅ AA compliant |
| Secondary color | `#6c757d` | `#9E9E9E` | ~6.3:1 | ✅ AAA compliant |
| Primary button | `#66BB6A` | `#43A047` | ~4.5:1 | ✅ AA compliant |

Location: `src/popup/styles.css`

### Testing Checklist

When adding new UI features, use the following checklist:

#### Keyboard Accessibility

- [ ] All interactive elements operable via keyboard (`Tab`, `Enter`, `Esc`, etc.)
- [ ] Focus order matches visual order
- [ ] Focus indicators clearly visible
- [ ] Modals/dialogs/drag operations cancelable with `Esc`

#### Screen Reader

- [ ] All buttons and links have labels
- [ ] Icon-only buttons have `aria-label`
- [ ] Form elements properly labeled
- [ ] Error messages announced by screen reader
- [ ] Dynamic content uses `aria-live`

#### Color and Vision

- [ ] Information not conveyed solely by color (text also used)
- [ ] Text-to-background contrast ratio ≥4.5:1
- [ ] Required fields, errors, success states clearly identifiable

#### Modals and Focus Traps

- [ ] Opening modal moves focus into modal
- [ ] Pressing `Tab` in modal keeps focus within modal
- [ ] `Esc` closes modal
- [ ] Closing modal returns focus to element that opened it

### Recommended Testing Tools

- [Lighthouse](https://developers.google.com/web/tools/lighthouse) - Chrome DevTools integration
- [axe DevTools](https://www.deque.com/axe/devtools/) - Automated accessibility testing
- [WAVE](https://wave.webaim.org/) - WebAIM evaluation tool
- Screen readers (NVDA, JAWS, VoiceOver)