# PBI: MCP ブリッジのレシピ文書化（既存 webhook エクスポート経由）

## ユーザーストーリー
端末内のエージェントから履歴に問い合わせたいユーザーとして、MCP クライアントから Yasumaro の記録にアクセスするレシピがほしい、なぜなら既存の webhook エクスポートで低コストに同等の選択肢を提供できるから。

## 優先度
- 順位: 7 / 9（全候補）
- RICEスコア: 2.0（Reach=1 / Impact=1 / Confidence=50% / Effort=0.25人週）
- 根拠: 類似 OSS の Memex（memex.garden）は MCP サーバーを露出しており、エージェント連携のトレンドが確認できる。Yasumaro は既存の webhook エクスポート（6.9.63 出荷・opt-in・送信直前 PII マスキング・宣言済み host_permissions ゲート・未宣言 origin fail-closed）を経由すれば、コード追加なしで同等の選択肢をレシピ文書化できる。既存 C2 / E7 の文書版に相当し、C2 の opt-in 前提（既定 ON の外部送信をしない）を維持するため Confidence は 50% に抑えている

## ビジネス価値
- コード追加ゼロでエージェント連携の選択肢を提供できる。MCP サーバー実装（ネイティブメッセージングホスト等）はスコープ外とし、「ローカルで動く小さなブリッジをユーザーが用意する」形に限定することで、常駐プロセスをリポジトリに持ち込まない（軸5）
- webhook エクスポートのセキュリティ前提（opt-in・送信直前 PII マスキング・宣言済み host_permissions ゲート・未宣言 origin fail-closed）をレシピがそのまま引き継ぐため、安全性の説明が既存文書と一致する
- 測定方法: README と guides 総覧からレシピへ到達できること、レシピの手順が既存の webhook エクスポート設定だけで動くことの確認結果、エージェント連携関連の issue や問い合わせでレシピが参照されること

## BDD受け入れシナリオ

```gherkin
Scenario: レシピが日英で存在し文書一覧から到達できる
  Given docs/ に MCP ブリッジのレシピ文書が日本語版と英語版で存在する
  And README の文書一覧にレシピへのリンクがある
  And guides 総覧（docs/index.html と GitHub Pages の guides.html）にもレシピがある
  When ユーザーが文書一覧からレシピを開く
  Then ローカルブリッジの用意から MCP クライアントでの利用までの手順が読める
  And コード追加が不要であることが明記されている

Scenario: レシピの手順が既存の webhook エクスポート設定だけで動く
  Given ユーザーが既存の webhook エクスポートを opt-in で設定済みである
  And ローカルで動く小さなブリッジ（例: ローカル HTTP エンドポイント → MCP 変換）を用意している
  When MCP クライアントから Yasumaro の記録への問い合わせを実行する
  Then webhook エクスポートの既存設定だけで応答が得られる
  And レシピに opt-in・送信直前 PII マスキング・host_permissions ゲート・未宣言 origin fail-closed の前提が記載されている
```

## 受け入れ基準
- [x] docs/ にレシピ文書が日英（日本語版・英語版）で新規作成されている
- [x] README の文書一覧にレシピへのリンクが追加されている
- [x] guides 総覧（docs/index.html と GitHub Pages の guides.html、管理先は実装時に確認）にレシピが追加されている
- [x] レシピの手順が既存の webhook エクスポート設定だけで動くことが確認されている（コード追加なし）
- [x] レシピに webhook エクスポートのセキュリティ前提（opt-in・送信直前 PII マスキング・宣言済み host_permissions ゲート・未宣言 origin fail-closed）が正確に記載されている
- [x] MCP サーバー実装（ネイティブメッセージングホスト等）の手順や、既定 ON の外部送信を勧める手順が含まれていない

## テスト戦略
ドキュメント作業のため自動テスト対象外。検証は「レシピの手順が既存設定だけで動くことの確認」で行う。

1. webhook エクスポートを opt-in で有効化した既存設定を用意する
2. レシピの手順に従いローカルブリッジ（例: ローカル HTTP エンドポイント → MCP 変換）を起動する
3. MCP クライアントから問い合わせし、webhook エクスポート経由の応答が返ることを確認する
4. 未宣言 origin への fail-closed 動作がレシピ記載どおりであることを確認する
5. 文字種チェック（node scripts/check-docs-chars.mjs）が exit 0 であることを確認する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）

```bash
grep -rn "webhook" docs/ | head -10
grep -rn "WEBHOOK\|Webhook" src/ | head -10
```

### 実装手順
1. 上記 grep で webhook エクスポートの既存文書（6.9.63 出荷分）と src/ 側の設定を確認する
2. docs/ にレシピ文書を日英で新規作成する（ローカル HTTP エンドポイント → MCP 変換の手順。ローカルで動く小さなブリッジをユーザーが用意する形に限定）
3. webhook エクスポートのセキュリティ前提（opt-in・送信直前 PII マスキング・宣言済み host_permissions ゲート・未宣言 origin fail-closed）をレシピに正確に転記し、マスク必須の per-domain 送信政策との組み合わせを推奨として記載する
4. README の文書一覧にレシピを追加する
5. guides 総覧（docs/index.html と GitHub Pages の guides.html）の管理先を確認し、レシピを追加する
6. レシピの手順が既存設定だけで動くことを確認する（コード追加なし）
7. 文字種チェック（node scripts/check-docs-chars.mjs）を実行して exit 0 を確認する

### 落とし穴
- webhook エクスポートのセキュリティ前提（PII マスキング・host_permissions ゲート・fail-closed）の転記漏れ・転記誤り。記載が実際の動作とずれると誤送信の誤解を招く
- 既定 ON の外部送信を勧める手順を書いてしまうこと。C2 の opt-in 前提を維持する
- MCP サーバー実装そのもの（ネイティブメッセージングホスト等）を書き始めること。スコープ外であり、常駐プロセスをリポジトリに持ち込まない（軸5）
- 文書一覧の重複（README と docs/index.html と guides.html）の管理先を確認せずに、一覧の一部だけ更新して別の一覧を欠落させること。着手時に確認する
- 範囲外文字（EM DASH の U+2014、矢印・近似・不等号系の範囲外版）を書き込むこと。横棒は ―（U+2015）、不等号は ≧ ≦、近似は ≒、双方向矢印は ⇔ を使う

## 見積もり
1pt目安（0.25人週相当）

## Definition of Done
- [x] レシピ文書が日英で完成
- [x] 文書一覧（README・guides 総覧）に追加済み
- [x] 既存設定での動作確認済み
- [x] コードレビュー（ドキュメントレビュー）完了

## 参照
- ブレスト報告書: docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md（エージェント連携のトレンド調査）
- 既存 webhook エクスポートの文書とコード（docs/・src/ 配下、実装時に grep で特定）
- 前提修正: [2026-10-31-10-feat-webhook-loopport-match.md](2026-10-31-10-feat-webhook-loopport-match.md)。ローカル HTTPS 宛先が宣言済み origin ゲートを通るためには、この修正（isUrlCoveredByHostPattern のポート照合）を含むビルドが前提
