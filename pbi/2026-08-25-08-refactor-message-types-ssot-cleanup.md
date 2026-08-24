# PBI: CONTENT_SCRIPT_ONLY_TYPES の二重SSOTを解消し LAYERS.md を正す

## ユーザーストーリー
開発者として、CONTENT_SCRIPT_ONLY_TYPES の deprecated 二重SSOTを削除したい、なぜなら新 message type を追加した際に古い定数が更新されず、content script の正当なメッセージが拒否される事故を防ぎたいから。併せて LAYERS.md の layer 乖離を正し、依存方向を明確にしたい

## 優先度
- 順位: 6 / 9
- RICEスコア: 20.0（Reach=5 / Impact=1 / Confidence=80% / Effort=0.20w）
- 根拠: 小粒だが即効性あり。05 の DI 整理後に実行すると MessageRouter の型整理と整合しやすい。

## ビジネス価値
- message type 追加時の「片方だけ更新」事故を 0 にできる
- LAYERS.md と実装の乖離が解消し、新規参入者の誤った依存を防げる

## BDD受け入れシナリオ

```gherkin
Scenario: 新 type が古い定数なしでも許可される
  Given CONTENT_SCRIPT_ALLOWED_TYPES に `NEW_TYPE` を追加する
  When content script から NEW_TYPE を送信する
  Then MessageRouter が許可し、旧定数の有無に関わらず通過する

Scenario: 旧定数の参照が 0 になる
  Given CONTENT_SCRIPT_ONLY_TYPES を削除する
  When `grep -rn CONTENT_SCRIPT_ONLY_TYPES src/` を実行する
  Then ヒットが 0 件になる

Scenario: LAYERS.md が実装と一致する
  Given providerRegistry の layer を修正する
  When dev-docs/LAYERS.md を読む
  Then 記載と実装の依存方向が一致している
```

## 受け入れ基準
- [ ] `src/background/messageTypes.ts:236-254` の `CONTENT_SCRIPT_ONLY_TYPES` が削除され、`CONTENT_SCRIPT_ALLOWED_TYPES` のみが SSOT として残る
- [ ] `src/background/handlers/MessageRouter.ts` が `CONTENT_SCRIPT_ALLOWED_TYPES` のみを参照
- [ ] `grep -rn CONTENT_SCRIPT_ONLY_TYPES` が 0 件
- [ ] `dev-docs/LAYERS.md` が providerRegistry の所属 layer を正しく記載し、CI の import-linter で検証される

## テスト戦略

### 統合テスト
- MessageRouter の registry が VALID_MESSAGE_TYPES と CONTENT_SCRIPT_ALLOWED_TYPES の集合差分を検出するテスト（既存 validators.test.ts を拡張）

### 単体テスト
- 新 type 追加時の回帰テスト: 旧定数なしでも content script からの送信が許可される

## 見積もり
1pt

## 技術的考慮事項
- 依存関係: 05 の ServiceContainer 整理後に実行すると MessageRouter の依存整理と同時に行いやすい
- 非機能要件: 削除のみで本番挙動は変えない（ただし旧 import があるとビルドエラーになるため、事前に全置換する）

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "CONTENT_SCRIPT_ONLY_TYPES\|CONTENT_SCRIPT_ALLOWED_TYPES" src/
cat dev-docs/LAYERS.md
```

### 実装手順
1. `src/` 全体の `CONTENT_SCRIPT_ONLY_TYPES` を `CONTENT_SCRIPT_ALLOWED_TYPES` に置換
2. `messageTypes.ts` から旧定数を削除し、CHANGELOG に「1リリースで削除」旨を記載
3. `LAYERS.md` の providerRegistry 行を修正し、`eslint` の `import/no-restricted-paths` で検証

### 落とし穴
- 旧定数を即座に削除すると、別ブランチで古い定数を使っている PR がコンフリクトする。1リリースは deprecated として残す選択肢もあるが、本 PBI は RICE 20 の小粒なため一括削除を推奨。事前に `git branch -a` で影響ブランチを確認する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `grep` で旧定数 0 件を確認
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（CHANGELOG, LAYERS.md）
