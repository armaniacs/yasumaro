# PBI: web_accessible_resources 露出最小化 — fingerprinting対策

## ユーザーストーリー
拡張機能ユーザーとして、content scriptが公開するリソースが必要最小限に絞られてほしい、なぜなら `web_accessible_resources` が `http://*/* https://*/*` の全サイトに `content-extractor.js` を晒すと、任意サイトから拡張機能の存在をfingerprintingでき、標的型攻撃の踏み台になるから

## 優先度
- 順位: 2 / 12
- RICEスコア: 4000 (Reach=500 / Impact=1 / Confidence=80% / Effort=0.10人月)
- 根拠: 全ユーザー・全ページで実行されるcontent scriptの露出。修正はwxt.config.ts:80-85の数行で即効。01 CSPと同点だがSSRFより機密影響はやや低いため2位。依存なしだが同ファイル変更のため01と同バッチ推奨

## ビジネス価値
- プライバシー: 拡張機能存在の検出可能性を低減（`chrome-extension://<id>/content-extractor.js` のfetch可否で判定される攻撃）
- セキュリティ: 不要なresource（icons/icon48.png）が本当に必要か棚卸し、面を削減
- 測定: `chrome.runtime.getManifest().web_accessible_resources` のスナップショットが期待値と一致、任意サイトからのfetchで404/CSPブロックを確認

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — content scriptの抽出は従来通り動作する
  Given 拡張機能がインストールされ、任意のhttpsページを開いている
  When content script が chrome.runtime.getURL('content-extractor.js') をfetchする
  Then スクリプトが正常にロードされ、ページ内容の抽出が成功する
  And popupの履歴にページが記録される

Scenario: 境界ケース — 不要なリソースは公開されない
  Given 拡張機能のmanifestを検査する
  When web_accessible_resources.resources を列挙する
  Then content-extractor.js 以外（例: icon48.png）が不要なら含まれていない
  And 必要ならmatchesは最小限のオリジンに限定されている

Scenario: エラーケース — 任意サイトからの直接fetchはブロックされる（将来の絞り込み時）
  Given 将来matchesを特定オリジンに絞った場合
  When 許可外オリジンから chrome-extension://<id>/content-extractor.js をfetchする
  Then CSP/web_accessible_resources によりブロックされる
```

## 受け入れ基準
- [ ] `wxt.config.ts:80-85` の `resources` が必要最小限（content-extractor.js 必須、icon48.pngは使用箇所が無ければ除去）
- [ ] `matches` が `['http://*/*','https://*/*']` のままなら、その理由がコメントで明記されている（content scriptは全ページで動作するため全オリジン許可が正当化される場合）
- [ ] 不要resource除去時は `src/content/loader.ts` / `extractor.ts` の動作に回帰が無い
- [ ] `npm run build` 後のmanifestスナップショットテストがパス

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwrightで拡張機能をロードし、任意httpsページで `fetch(chrome.runtime.getURL('content-extractor.js'))` が成功することを確認
- 任意ページのコンソールから `fetch(chrome.runtime.getURL('icons/icon48.png'))` が不要ならブロックされることを確認

### 統合テスト
- `wxt.config.ts` のmanifest生成結果から `web_accessible_resources` をassert
- `src/content/loader.ts` が `content-extractor.js` を正しく注入することをスタブで検証

### 単体テスト
- manifest生成ヘルパーのテスト: resources配列に期待値のみ含む、matchesが期待値と一致
- 不要resourceが除去された場合の分岐テスト

## 実装アプローチ
- **Outside-In**: E2E content抽出テスト(失敗) → 統合 manifestテスト(失敗) → 単体 resourcesテスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD

## 見積もり
1pt（要チーム見積もり）— 数時間の小規模修正だがE2Eでのfingerprinting検証を含む

## 技術的考慮事項
- 依存関係: なし。ただし01/03/04/05/06と同ファイルのため同バッチで一括レビュー推奨
- テスタビリティ: manifestは静的生成なので単体でassert可能。E2EはChrome拡張コンテキストが必要
- 非機能要件: content scriptは全ページで動作するため、matchesを絞りすぎると一部サイトで抽出失敗。絞り込みは慎重に
- 現状コメント: wxt.config.ts:69-79 に「content script以外は不要」旨が既にコメント済み。icon48.pngが本当にcontent側からfetchされているか要確認（`grep -rn icon48 src/content/`）

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "web_accessible_resources" wxt.config.ts
grep -rn "content-extractor" src/content/ wxt.config.ts
grep -rn "icon48" src/ wxt.config.ts
cat dist/chromium-mv3/manifest.json | grep -A10 web_accessible_resources
```

### 実装手順
1. `grep -rn "icon48" src/content/` でcontentからの参照有無を確認。無ければ `resources` から除去
2. `wxt.config.ts:84` の `matches` が全オリジン必要な理由をコメントに明記。不要なら特定オリジンに絞る（例: `<all_urls>` ではなく `https://*/*` のみに）
3. `npm run build && cat dist/**/manifest.json` で差分確認
4. Playwright E2Eで抽出動作の回帰確認

### 落とし穴
- `content-scripts/content.js` はmanifestの `content_scripts` で注入されるため `web_accessible_resources` に不要（既存コメント通り）。誤って追加しない
- iconを除去すると `chrome.runtime.getURL('icons/icon48.png')` をcontent側で使っている箇所があれば破綻。事前grep必須
- matchesを絞ると `http://` サイトで動作しなくなる。http対応が必要かプロダクト判断

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（PRでmanifest差分を貼付け、fingerprinting観点を確認）
- [ ] リファクタリング完了
- [ ] ロールバック手段: 旧resources/matchesに戻す1行revertで切り戻し可能
- [ ] ドキュメント更新済み（manifest変更はCHANGELOGに記載）
