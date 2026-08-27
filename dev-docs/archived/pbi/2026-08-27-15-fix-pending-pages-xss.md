# PBI: pendingPages Stored XSS

## ユーザーストーリー
攻撃者に悪意あるURLを保存された一般ユーザーとして、pendingPagesリストのURLがエスケープされ安全に表示されるようにしたい、なぜなら `value="${page.url}"` が `innerHTML` に無エスケープで流し込まれると Stored XSS により拡張機能の特権コンテキストで任意スクリプトが実行されるから。

## 優先度
- 順位: 1 / 17
- RICEスコア: 4800（Reach=80 / Impact=3 / Confidence=100% / Effort=0.05）
- 根拠: 全pendingPages利用者に影響 (Reach=80)。拡張機能特権でのXSSは高影響 (Impact=3)。`src/popup/pendingPages.ts:33` の `value="${page.url}"` が `innerHTML` に無エスケープであることは確信100%。1行修正でEffort極小 (0.05)。

## なぜなぜ分析
- なぜXSSが成立するか: `pendingPages.ts:32-33` で `item.innerHTML = \`… value="${page.url}" …\`` と文字列補間し、`page.url` に `escapeHtml` が掛かっていないため
- なぜ `escapeHtml(page.title)` は掛かっているのに `page.url` は漏れたか: title/reasonはエスケープする意識があったが、`<input value="">` 属性値も同様にエスケープが必要という認識が欠落していた
- なぜ気づかなかったか: テストが正常URLのみで検証し `"><img onerror=alert(1)>` のようなペイロードでの検証が無かった
- 解: `escapeHtml(page.url)` を掛ける、または `createElement` + `property` 代入 (`input.value = page.url`) に置換

## ビジネス価値
pendingPagesのStored XSSを解消し、攻撃者が保存した悪意あるURL経由で拡張機能コンテキストの権限奪取・データ窃取が行われるリスクを除去する。Chrome Web Store審査での却下リスクも低減。

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — 正常URLはそのまま表示・選択できる
  Given pendingPagesに { url: "https://example.com/page", title: "Example" } が保存されている
  When popupでpendingPagesリストを開く
  Then リストにURLがテキストとして表示され、checkboxのvalueが "https://example.com/page" として保持される
  And  スクリプトは実行されない

Scenario: 攻撃 — 悪意あるURLはエスケープされスクリプト実行されない
  Given pendingPagesに { url: "\"><img src=x onerror=alert(1)>", title: "x" } が保存されている
  When popupでpendingPagesリストを開く
  Then DOM上で <img> タグは生成されず、属性値はエスケープされた文字列として表示される
  And  alert等のスクリプトは実行されない
```

## 受け入れ基準
- [ ] `src/popup/pendingPages.ts:33` の `value="${page.url}"` が `escapeHtml(page.url)` または `createElement` + `input.value = page.url` / `setAttribute` による安全な代入に置換されている
- [ ] `innerHTML` テンプレート内の全ての `page.url` 参照がエスケープまたはDOM property代入で無害化されている
- [ ] `page.title` / `page.reason` と同様に `page.url` のエスケープが一貫している
- [ ] 既存テスト `src/popup/__tests__/pendingPages.test.ts` がパスし、XSSペイロード (`"><svg onload=alert(1)>`, `javascript:` 等) の追加テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- popup HTMLでpendingPagesリストを描画し、悪意あるURLがDOMでエスケープされることを手動確認（Chrome拡張のpopupをロード）

### 統合テスト
- `loadPendingPages()` をjsdomで呼び出し、`getPendingPages()` がXSSペイロードを返した際に `pending-pages-list` のinnerHTMLにスクリプトタグが生成されないことを検証

### 単体テスト
- `escapeHtml` が `"`, `'`, `<`, `>`, `&` を正しくエスケープすることを検証
- `loadPendingPages` の新実装が `value` 属性に `"><img onerror=alert(1)>` を渡しても `querySelector('.pending-checkbox').value` が期待通りかつ `innerHTML` に `<img` が含まれないことを検証
- 境界値: 空文字URL、非常に長いURL (2048文字)、`javascript:` スキーム

## 実装アプローチ
- **Outside-In**: E2E (popup描画確認) → 統合 (loadPendingPages呼び出し) → 単体 (escapeHtml / DOM生成) の順で失敗テストを書き、実装でグリーン化
- **Red-Green-Refactor**: まずXSSペイロードで失敗するテストを書き、次に `escapeHtml(page.url)` または `createElement` 置換でパスさせる
- **リファクタリング**: グリーン後に `innerHTML` テンプレート全体を `createElement` ベースに置換するか検討（XSS面でより堅牢）

## 見積もり
0.05pt（1行修正、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（`src/popup/domUtils.ts:escapeHtml` は既存）
- テスタビリティ: jsdomで `loadPendingPages` を直接テスト可能。`chrome.storage` はモック
- 非機能要件: セキュリティ（Stored XSS解消）。CSPは `innerHTML` 使用を避けることで強化
- 影響範囲: `src/popup/pendingPages.ts` のみ。`src/dashboard/historyPendingPanel.ts` は同様のパターンが無いか併せて確認

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -rn "pendingPages\|innerHTML" src/popup/pendingPages.ts
grep -rn "escapeHtml" src/popup/domUtils.ts src/popup/pendingPages.ts
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。

### 実装手順
1. `src/popup/pendingPages.ts:32-38` を読む。現状 `item.innerHTML = \`… value="${page.url}" …\`` であることを確認
2. 修正案A（最小）: `value="${escapeHtml(page.url)}"` に置換。`escapeHtml` は既に `page.title` で使用済み
3. 修正案B（推奨）: `innerHTML` をやめ `const cb = document.createElement('input'); cb.type='checkbox'; cb.value=page.url; cb.className='pending-checkbox';` のようにproperty代入に置換（属性エスケープ不要で最も安全）
4. `src/popup/__tests__/pendingPages.test.ts` にXSSペイロードのテストを追加し `npm run type-check && npm test` で検証
5. 手動で `chrome://extensions` でpopupを開き、pendingPagesに悪意あるURLを保存して描画を確認

### 落とし穴
- `escapeHtml` は `& < > " '` をエスケープするが、`value` 属性のコンテキストでは `"` のエスケープが必須。`escapeHtml` の実装が `"` を `&quot;` に変換することを確認
- `createElement` + `property` 代入にした場合、`dataset.url = page.url` も同様にpropertyなので安全だが、`innerHTML` に残る他の補間が無いか確認
- `historyPendingPanel.ts` でも同様の `innerHTML` + `page.url` が無いか `grep -rn "innerHTML" src/dashboard/` で確認

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（本修正は1行のエスケープ追加のため、問題時はrevertで即時切り戻し可能）
- [ ] ドキュメント更新済み
