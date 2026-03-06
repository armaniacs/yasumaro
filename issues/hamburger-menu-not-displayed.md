# Issue: ハンバーガーメニューが表示されない問題

**作成日**: 2026-01-16
**優先度**: 高
**タイプ**: バグ修正

## 問題の概要

ポップアップUIの右上にハンバーガーメニューボタン（☰）が表示されず、設定画面にアクセスできない。その結果、API Keyの設定ができず、拡張機能が使用できない状態になっている。

## 症状

1. **ハンバーガーメニューボタンが非表示**
   - 右上に「☰」ボタンが表示されるはずだが、画像では見えない

2. **設定画面にアクセス不可**
   - ハンバーガーメニューがないため、設定画面を開けない

3. **API Key missing エラー**
   - 設定できないため「エラー: API Key missing」が表示される
   - 拡張機能の基本機能が使用できない

## スクリーンショット

![問題のスクリーンショット](../tmp/image2.png)

## 根本原因の分析

### 調査結果（更新: 2026-01-16）

**✅ 問題を特定しました！**

#### 問題1: 文字コード宣言の欠落

1. **popup.html に `<meta charset="UTF-8">` が欠けていた**
   - `src/popup/popup.html:5` に charset メタタグが**ない**
   - これにより、Chromeが UTF-8 文字を正しく認識できない
   - 「☰」（UTF-8: `e2 98 b0`）が「答-」と文字化けしていた

2. **バイナリ解析で確認**
   ```bash
   $ hexdump -C popup.html | grep menuBtn
   # 結果: e2 98 b0 が正しく保存されている（UTF-8エンコーディング）
   ```
   - ファイル自体は正しく UTF-8 で保存されている
   - しかし、HTMLに charset 宣言がないため、Chromeが誤認識

#### 問題2: Content Scriptの未注入

1. **「Receiving end does not exist」エラー**
   - `src/popup/main.js:43` で `chrome.tabs.sendMessage()` を呼んでいる
   - しかし、タブに content script がまだ注入されていない
   - 拡張機能更新前に開いていたタブには content script が自動注入されない

2. **Content Script実装は正常**
   - `src/content/extractor.js:86-96` に GET_CONTENT リスナーが正しく実装されている
   - タブをリロードすれば content script が注入される

### 根本原因まとめ

| 問題 | 原因 | 症状 |
|------|------|------|
| ハンバーガーメニュー文字化け | `<meta charset="UTF-8">` 欠落 | 「☰」が「答-」と表示 |
| 手動記録エラー | タブに content script 未注入 | "Receiving end does not exist" |

## 修正完了

### 実施した修正

#### ✅ 修正1: charset メタタグを追加

**変更ファイル**: `src/popup/popup.html`

**変更前**:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Obsidian Weave Settings</title>
```

**変更後**:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Obsidian Weave Settings</title>
```

**効果**:
- Chromeが UTF-8 文字を正しく認識するようになる
- 「☰」が正しく表示される

---

## 検証手順（必須）

### Phase 1: 拡張機能の再読み込み

**手順**:

1. **Chrome拡張機能ページを開く**
   ```
   chrome://extensions
   ```

2. **Developer Modeを有効化**
   - 右上のトグルスイッチをONにする

3. **拡張機能を再読み込み**
   - "Obsidian Weave" の「更新」（Reload）ボタンをクリック

4. **現在のタブをリロード**
   - **重要**: 拡張機能を更新した後、テストするタブを**必ずリロード**してください
   - これにより content script が注入されます

5. **ポップアップを開き直す**
   - 拡張機能アイコンをクリックしてポップアップを開く

**期待される結果**:
- ハンバーガーメニューボタン（☰）が右上に**正しく**表示される
- ボタンをクリックすると設定画面に遷移できる
- 「今すぐ記録」ボタンが正常に動作する（エラーが出ない）

### Phase 2: 検証とデバッグ

**JavaScriptエラーの確認**:

1. ポップアップを右クリック → 「検証」（Inspect）
2. Consoleタブでエラーがないか確認
3. エラーがある場合はログを記録

**HTMLの検証**:

1. Elementsタブで以下を確認:
   ```html
   <button id="menuBtn" class="icon-btn">☰</button>
   ```
   このボタンがDOM内に存在するか確認

2. CSSスタイルを確認:
   - `display: flex` が適用されているか
   - `visibility: hidden` や `opacity: 0` になっていないか

### Phase 3: 必要に応じたコード修正

**もし Phase 1, 2 で解決しない場合**:

#### Option A: navigation.js の初期化を確実にする

現状の問題点:
- `navigation.js` は `popup.js` から `initNavigation()` が呼ばれるまで初期化されない
- スクリプトロード順序に依存している

修正案:
```javascript
// navigation.js の最後に追加
// DOMContentLoaded で確実に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

#### Option B: popup.html の script タグ順序変更

現状:
```html
<script type="module" src="navigation.js"></script>
<script type="module" src="main.js"></script>
<script type="module" src="popup.js"></script>
<script type="module" src="domainFilter.js"></script>
```

変更後（popup.js を最初に）:
```html
<script type="module" src="popup.js"></script>
<script type="module" src="navigation.js"></script>
<script type="module" src="main.js"></script>
<script type="module" src="domainFilter.js"></script>
```

#### Option C: インラインスクリプトで即座に初期化

popup.html の最後に追加:
```html
<script>
  // 確実にボタンが存在することを確認
  window.addEventListener('DOMContentLoaded', () => {
    const menuBtn = document.getElementById('menuBtn');
    console.log('menuBtn exists:', !!menuBtn);
    if (!menuBtn) {
      console.error('menuBtn not found in DOM');
    }
  });
</script>
```

## 検証手順

### 成功基準

1. **ハンバーガーメニューボタンが表示される**
   - 右上に「☰」ボタンが見える
   - ホバー時に背景色が変わる（#e0e0e0）

2. **設定画面への遷移が動作する**
   - 「☰」ボタンクリック → 設定画面が表示される
   - 「←」ボタンクリック → メイン画面に戻る

3. **API Key設定が可能**
   - 設定画面で Obsidian API Key を入力できる
   - 「Save & Test Connection」が動作する

### テストケース

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | ポップアップを開く | メイン画面が表示され、右上に☰ボタンがある |
| 2 | ☰ボタンをクリック | 設定画面に遷移し、「一般」タブが表示される |
| 3 | ←ボタンをクリック | メイン画面に戻る |
| 4 | 再度☰をクリック → 「ドメインフィルター」タブをクリック | ドメインフィルター設定が表示される |
| 5 | API Key入力 → Save & Test | 接続テストが実行される |

## 関連ファイル

### 修正対象ファイル（必要に応じて）

- `src/popup/popup.html` - ハンバーガーメニューボタンのHTML
- `src/popup/navigation.js` - 画面遷移ロジック
- `src/popup/popup.js` - 初期化処理の統合

### 調査済みファイル

- `src/popup/main.js` - メイン画面機能（正常）
- `src/popup/domainFilter.js` - ドメインフィルター（正常）
- `src/utils/storage.js` - ストレージ管理（正常）

## 推奨される対応順序

1. **まず Phase 1 を実施** (5分)
   - Chrome拡張機能の再読み込み
   - 多くの場合、これで解決する

2. **解決しなければ Phase 2 を実施** (10分)
   - JavaScriptエラーの確認
   - DOM構造の検証

3. **それでも解決しなければ Phase 3 を実施** (30分)
   - navigation.js の初期化を確実にする修正
   - テストして動作確認

## 次のステップ

1. ユーザーに Phase 1 の手順を実施してもらう
2. 問題が解決したか確認
3. 解決しない場合は Phase 2, 3 に進む
4. 修正が完了したらコミット

## 備考

- この問題は Chrome Extension Manifest V3 の特性（Service Worker、ES6 Modules）に関連している可能性がある
- 同様の問題が再発しないよう、拡張機能の開発手順に「リロード」を明記する必要がある
