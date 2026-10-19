# PBI: ストア公開スクリプト群の堅牢性束（検証通過10件）

## ユーザーストーリー
リリース担当者として、公開自動化の失敗切り分けに何時間もかかってほしくない。なぜならログの単位誤り・ID 未検証・テスト欠落の分岐は障害時にしか発火せず、原因特定が振り出しに戻るから。

## 優先度
- 順位: 08 / 08
- RICEスコア: 8（Reach=5 / Impact=2 / Confidence=0.8 / Effort=1.0）
- 根拠: 発火はリリース障害時のみだが発火時の調査コスト大。10件一括で SP 1.5。依存なし。

## 背景
adversarial-code-review (2026-10-16) の検証通過指摘 (保守 publish 17件中 SURVIVES 10件)。反証で各行を確認済み。ハッカー視点では穴0件（secrets・注入・SSRF・権限はいずれも不成立）。
- [x] P3 `scripts/publish/cws.mjs:116` ― `[...text].length` を bytes 表示。`Buffer.byteLength` に寄せる。
- [x] P4 `scripts/publish/cws.mjs:140-143` ― ポーリング枯渇時も終端失敗と同一文言。Edge (`edge.mjs:76-77` "did not finish in time") と parity を取る。
- [x] P5 `scripts/publish/cws.mjs:59-61` / `edge.mjs:54-59` ― ID 欠落を `?? ''` 化し空のまま投げる。token 空チェック (`cws.mjs:83-89`) にならい ID 事前検証＋fail-fast。
- [x] P8 `scripts/publish/edge.mjs:82-88` ― Location 最終断片を素取り。URL 解析で operationId を抽出（クエリ/末尾スラッシュ耐性）。
- [x] P12 `scripts/publish/lib.mjs:213-221` ― `defaultRun` が `console.error` 直書き。注入 `log` 経由に寄せる。
- [x] P13 `scripts/publish/cws.mjs:131-135,175-179` ― パース失敗分岐のテスト欠落。`publish-stores.test.ts` に対応ケース追加。
- [x] P14 `scripts/publish/lib.mjs:192-197` ― transport 失敗経路のテスト欠落。同上。
- [x] P15 `scripts/__tests__/publish-stores.test.ts:46,279-302` ― モック `includes` 順序依存。厳密マッチに寄せる。
- [x] P16 `.github/workflows/release.yml:129,142` ― Prepare 非 `always()` / Submit `always()+hashFiles` の非対称。対称化（両方に失敗時方針を明記）。
- [x] P17 `scripts/publish/amo-submit.mjs:44-62` ― ソース zip 存在確認なし・成功時ログゼロ。存在確認＋成功ログ追加。
- 却下済み: token `[object Object]`・status 表示・timeout 未渡し・沈黙スキップ・202 厳密・表記厳密・StepFailed 契約はいずれも仕様・テスト・明示ログで反証済みのため対象外。

## BDD受け入れシナリオ
Scenario: ID 欠落は投げずに即失敗する
  Given 空の extension/product ID
  When 実行する
  Then リクエスト前に欠落エラーで exit 非ゼロになる

Scenario: operationId 抽出が URL 変形に耐える
  Given クエリ付き・末尾スラッシュ付き Location
  When 抽出する
  Then 正しい operationId で poll する

Scenario: 失敗分岐がテストで pin される
  Given パース失敗・transport 失敗のモック
  When 実行する
  Then 対応する失敗文言で終了する（新規テスト緑）

## 受け入れ基準
- [x] 上記10件が修正・テスト追加され `npx vitest run scripts/__tests__/publish-stores.test.ts` 全緑
- [x] release.yml の対称化が目視確認できる

## テスト戦略
- 単体: publish-stores 追加ケース（Red→Green、実時間待ちなし・inject sleep）
- 既存: 同ファイル全緑

## 見積もり
1.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
