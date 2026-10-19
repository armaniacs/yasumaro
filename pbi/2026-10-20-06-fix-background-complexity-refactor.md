# PBI: background の高複雑度関数（複雑度 30 超ホットスポット）を構造的に分割する

## ユーザーストーリー

拡張機能の保守担当者として、background の最悪複雑度関数がテストしやすい単位に分割されてほしい、なぜなら `npx eslint --rule '{"complexity":["warn",15]}'` で 100 件ヒットするうち複雑度 30 超のホットスポットは分岐網羅が事実上不可能で、マイグレーション・復旧・記録パイプラインという high-risk 領域（AGENTS.md 指定）のバグが混入しやすく、2026-10-20 の簡素化パスでも「構造的リファクタは別セッション」として意図的に先送りされたから。

## 優先度

- 順位: 06 / 6
- RICE: 8.3（Reach=50 / Impact=1 / Confidence=50% / Effort=3.0）
- 根拠: 効果は確率的（複雑度低下 = バグリスク低減）で工数最大。全候補の中で最後に回すが、high-risk 領域という性質上、放置しない。依存は他候補となし
- 種別: 🔧非機能追加（fix） / 難易度: 🔴高 / 副作用: 🔴あり

## 背景（出典）

2026-10-20 の簡素化パス 未適用発見（background 高複雑度関数は一括リファクタをスコープ外とした）。ESLint complexity（閾値 15）の上位ホットスポット:

| ファイル | 行 | 複雑度 | 領域 |
|---|---:|---:|---|
| `src/background/pipeline/mappers/commonStorageFields.ts` | 101 | 41 | 記録パイプラインの共通フィールド抽出（幅広いフラット mapper） |
| `src/background/migration/legacyMigration.ts` | 267 | 38 | レガシーマイグレーション（storage high-risk） |
| `src/background/migration/opfsRecovery.ts` | 28 | 33 | OPFS 復旧（storage high-risk） |
| `src/background/sessionStore.ts` | 175 | 30 | セッションストア |
| `src/background/ai/RemoteAIService.ts` | 224 | 27 | AI 経路 |
| `src/background/pipeline/steps/checkPrivacyHeadersStep.ts` | 26 | 27 | パイプライン step |
| `src/background/handlers/recordingHandlers.ts` | 104 | 26 | 記録 handler |
| `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts` | 116 | 26 | dashboard sqlite |

注: commonStorageFields.ts:101 の 41 は広くフラットな mapper オブジェクトによる幅であってネストの深さではないため、**分割価値が高いのは legacyMigration.ts:267（38）と opfsRecovery.ts:28（33）**。本 PBI はこの 2 つを主対象とし、残りは測定して判断する。

### 制約

- 挙動は完全に不変（ストレージ・マイグレーションは high-risk。AGENTS.md「High-risk areas」）
- 1 関数 1 コミット。複数関数を 1 コミットに混ぜない
- 既存テストの期待値を書き換えて通さない（dev-docs/TEST_RULE.md の規約）

## BDD受け入れシナリオ

```gherkin
Scenario: レガシーマイグレーションの分岐は分割後も同一の結果になる
  Given 既存の legacyMigration テストが全件緑である
  When legacyMigration.ts:267 の関数を段階に分割する
  Then 全テストが無修正で通る
  And 各段（検出 / 変換 / 検証 / 書き込み）が個別にテスト可能になる

Scenario: OPFS 復旧の失敗経路が個別にテスト可能になる
  Given 既存の opfsRecovery テストがある
  When opfsRecovery.ts:28 の関数を分割する
  Then 全テストが無修正で通る
  And 複雑度が測定可能な上限（目安 15）以下に下がる
```

## 受け入れ基準

- [ ] 対象関数の分割前後で `npx eslint --rule '{"complexity":["warn",15]}'` の複雑度を測定し、対象関数が目安 15 以下に下がる。測定値を PR に添付
- [ ] 既存テストが無修正で通る（マイグレーション系・復旧系・パイプライン系）
- [ ] 1 関数 1 コミットで、commit message に before/after の複雑度を残す
- [ ] 分割の結果 `manifest.json` / `web_accessible_resources` の更新が必要になった場合は CLAUDE.local.md の分割ルールに従う（src/background 配下は対象外だが、util への切り出し時に確認）
- [ ] `npm run validate` が緑
- [ ] `npm run bench:micro` を before/after で実行し、性能退行がないことを確認（AGENTS.md の性能規約）

## テスト戦略

### 単体

既存のマイグレーション・復旧テストが挙動を固定。分割で抜けた経路があれば、**現在の挙動を固定する形**でテストを追加し、期待値を書き換えない。

### 統合

`npm test` 全件（16,444 件）が緑であること。

### E2E

手動マイグレーションシナリオ（レガシーストレージからの移行）を dev-docs/TESTING_GUIDE.md の手順で 1 回実行する。

## 実装メモ（実装者向け）

### 推奨アプローチ（段階的・1 関数ずつ）

1. **legacyMigration.ts:267（38）**: 関数の段（検出 → 変換 → 検証 → 書き込み）を各 module-private 関数に切り出す。戻り値・エラー文は不変
2. **opfsRecovery.ts:28（33）**: 同様に段を切り出す
3. **sessionStore.ts:175（30）/ RemoteAIService.ts:224（27）**: 測定して判断（15 に届かなくても段の切り出しで可読性が上がるなら実施）
4. **commonStorageFields.ts:101（41）**: フラット mapper の幅であり、構造的分割より**フィールドグループごとの分解**（privacy 系 / byte 系 / fallback 系）を検討。既存の why コメント（`?? null` vs `|| null` の意図）を保持すること

### ロールバック手順

- 1 関数 1 コミットのため `git revert <commit>` で関数単位に戻せる
- 分割は純粋な切り出し（同じ条件・同じ順序・同じエラー文）であり、戻す理由は通常ない
- 戻す場合も `npm run validate` を通すこと

## 見積もり

5pt 🔴（2 関数の分割 + 測定 + 検証。Effort=3.0 相当。残りホットスポットは別 PBI に分岐）

## Definition of Done

- [ ] 対象 2 関数（legacyMigration.ts:267 / opfsRecovery.ts:28）の複雑度が目安 15 以下
- [ ] `npm test` 全件緑（既存テスト無修正）
- [ ] `npm run validate` が緑
- [ ] before/after の複雑度測定値が PR に添付されている
- [ ] コードレビュー完了
- [ ] 残りホットスポットの判断（実施/見送り）が完了記録に残っている

## 関連

- pbi/00-INDEX.md
- pbi/2026-10-20-00-backlog-review-findings.md
- 出典: 2026-10-20 簡素化パス 未適用発見（background 高複雑度）
- 性能規約: dev-docs/PERFORMANCE_GUIDE.md / docs/PERFORMANCE_TEST.md
