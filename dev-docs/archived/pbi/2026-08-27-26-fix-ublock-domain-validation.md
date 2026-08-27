# PBI: ublockParser domain validation ワイルドカード誤容認

## ユーザーストーリー
開発者として、ublockParser のドメイン検証がワイルドカード `*` を誤って許容しないようにしたい、なぜなら `PATTERNS.DOMAIN_VALIDATION` が `*` を含むため `*.example.com` や `exa*mple.com` といった不正ドメインが `validateDomain` を通過し、uBlock フィルタの誤ったブロック/例外ルールとして保存・適用される攻撃面になるから。

## 優先度
- 順位: 6 / 17
- RICEスコア: 280（Reach=20 / Impact=1 / Confidence=70% / Effort=0.05）
- 根拠: uBlock インポートを利用する全ユーザーに影響 (Reach=20)。不正ドメインの混入による誤ブロッキングは限定的 (Impact=1)。正規表現に `*` が含まれることはコード確認で確実だが、悪用経路の到達性は中程度のため Confidence=70%。1文字削除の正規表現修正で Effort 極小。

## なぜなぜ分析
- なぜワイルドカードが通過するか: `src/utils/ublockParser/constants.ts:43` の `DOMAIN_VALIDATION` が `/^[a-z0-9._*-]+(\.[a-z0-9._*-]+)*$/i` と `*` を文字クラスに含むため
- なぜ `*` が含まれたか: uBlock 形式のワイルドカード記法とドメイン文字を混同し、ドメイン検証層でフィルタ記号を許容してしまった
- なぜ気づかなかったか: `validateDomain` のテストが `example.com` 等の正常系のみで、`*` を含む異常系をカバーしていない
- 解: 正規表現から `*` を除外し `/^[a-z0-9._-]+(\.[a-z0-9._-]+)*$/i` に修正

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常ドメインは通過する
  Given `example.com` / `sub.example.co.jp` / `a-b.example.com` を入力
  When `validateDomain` を呼ぶ
  Then `true` を返す

Scenario: 攻撃 — ワイルドカードを含むドメインは拒否される
  Given `*.example.com` を含むフィルタ行 `||*.example.com^`
  When `validateDomain("*.example.com")` を呼ぶ
  Then `false` を返す

Scenario: 攻撃 — ドメイン中間のワイルドカードも拒否される
  Given `exa*mple.com` を入力
  When `validateDomain` を呼ぶ
  Then `false` を返す

Scenario: エッジ — ハイフン・アンダースコア・ドットは引き続き許容される
  Given `my_domain.example-site.com` を入力
  When `validateDomain` を呼ぶ
  Then `true` を返す

## 受け入れ基準
- [ ] `src/utils/ublockParser/constants.ts:43` の `DOMAIN_VALIDATION` から `*` が除外されている
- [ ] `validateDomain("*.example.com")` が `false` を返す
- [ ] `validateDomain("exa*mple.com")` が `false` を返す
- [ ] `validateDomain("example.com")` が `true` を返す（リグレッションなし）
- [ ] `npx vitest run src/utils/__tests__/ublockParser.test.ts` がパスする（既存29ケース維持）

## テスト戦略
- 単体: `validateDomain` に `*` 混入パターン（先頭/中間/末尾）、ハイフン境界、二重ドットの組み合わせテストを追加
- 統合: `parseUblockFilterListWithErrors("||*.example.com^")` が invalid として除外されることを検証
- E2E: 不要

## 見積もり
0.05pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
