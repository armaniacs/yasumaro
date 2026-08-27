# PBI: extractor Boolean文字列反転

## ユーザーストーリー
開発者として、`src/content/extractor.ts` の `loadSettings` で boolean 設定の読み込みが文字列 `"false"` を `true` に反転させないようにしたい、なぜなら `Boolean("false") === true` であり、chrome.storage に文字列として保存された `"false"` が truthy としてクレンジング有効化を誤判定し、ユーザーの無効化設定が無視されるから。

## 優先度
- 順位: 6 / 17
- RICEスコア: 320（Reach=20 / Impact=1 / Confidence=80% / Effort=0.05）
- 根拠: 設定読み込みは全 content script 注入で実行されるが、文字列 `"false"` が保存されるケースはマイグレーションや外部編集の特定条件下のみ。Reach=20（クレンジング設定利用者）。Impact=1（クレンジングの誤有効化は局所的だがプライバシー設定の意図と逆行）。Confidence=80%（`Boolean(s[key])` の truthy 変換が原因であることは確実、発生頻度は中）。Effort=0.05（判定1行の修正）。

## なぜなぜ分析
- なぜ反転するか: `src/content/extractor.ts:160` で `pageState.cleansingConfig[prop] = Boolean(s[key])` と汎用 truthy 変換を行い、`"false"` / `"0"` などの文字列が `true` に評価されるため
- なぜ文字列が保存されるか: 旧設定形式や手動編集、マイグレーション途中の中間値で boolean が文字列化されて保存される可能性があるため
- なぜ気づかなかったか: 通常の保存経路では boolean 型で保存され `Boolean(true/false)` は正しく動作するため、文字列ケースのテストが存在しなかったため
- 解: `s[key] === true || s[key] === "true"` の strict 判定、または `String(s[key]).toLowerCase() === "true"` / `s[key] === true` の明示的パースに修正。数値・文字列の曖昧な truthy 変換を廃止

## BDD受け入れシナリオ
Scenario: ハッピーパス — boolean true/false は正しく反映される
  Given `chrome.storage.local.settings[StorageKeys.CONTENT_STRIP_HARD_ENABLED]` が `true` / `false`（boolean）である
  When `loadSettings()` を呼ぶ
  Then `pageState.cleansingConfig.contentStripHardEnabled` はそれぞれ `true` / `false` になる

Scenario: バグ再現 — 文字列 "false" は false として扱われる
  Given storage に `aiSummaryCleansingEnabled: "false"`（文字列）が保存されている
  When `loadSettings()` を呼ぶ
  Then `pageState.cleansingConfig.aiSummaryCleansingEnabled` は `false` になる（従来は `Boolean("false") === true` で誤って `true` になっていた）

Scenario: 境界 — 文字列 "true" は true、他は false
  Given storage に `"true"` / `"0"` / `""` / `0` / `1` が保存されている
  When `loadSettings()` を呼ぶ
  Then `"true"` のみ `true`、`"0"` / `""` / `0` は `false`（または仕様で定義した厳密な真偽値）に正規化される

## 受け入れ基準
- [x] `src/content/extractor.ts:158-162` の `Boolean(s[key])` が strict 判定（例: `s[key] === true || s[key] === "true"`）に置換されている
- [x] 32 ルール由来の `cleansingRuleKeys` を含む全 `booleanKeys` で文字列 `"false"` が `false` に正しく解釈される
- [x] 既存の boolean 型保存ケースの挙動が維持される（`true`→`true`、`false`→`false`）
- [x] `src/content/__tests__/extractor-comprehensive.test.ts` および `extractor-core.test.ts` がパスする
- [x] 文字列 `"false"` / `"true"` の回帰テストが1件以上追加されている

## テスト戦略
- 単体: `loadSettings` の boolean パース分岐テスト — `chrome.storage.local.get` をモックし、`"false"`（文字列）/`"true"`（文字列）/`true`/`false`/`0`/`1`/`""` を投入して `pageState.cleansingConfig[prop]` の真偽値を検証
- 統合: 実際の `PageState` インスタンスで `loadSettings` → `extractPageContent` まで通し、クレンジングフラグが期待通りに反映されること
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
