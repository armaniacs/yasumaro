# PBI: dashboardSqliteService のボイラープレートを汎用呼び出しで集約する

## ユーザーストーリー
開発者として、`dashboardSqliteService.ts`（704行）の19関数がすべて同一パターン（try → token確認 → sendDashboardMessage → 応答検証 → ServiceResult）をコピペしている状態を解消したい。なぜなら、トランスポートロジック（~130行）は既に整理済みなのに、19のAPI関数（~570行）が機械的コピペで、新API追加に30行要するから。

## 優先度
- 順位: 5 / 6
- RICEスコア: 0.63（Reach=5 / Impact=1 / Confidence=50% / Effort=4人日）
- 根拠: Worth exploring（確信50%）。純粋なボイラープレート削減（~450行）だが、TypeScript総称＋検証コールバックの型設計にコストがかかり、全19関数が単一パターンに収まるか不確実。

## ビジネス価値
- トランスポート＋検証が1関数に集約
- 新API＝1行（30行→1行）
- ~450行削除（704→~250行）

## BDD受け入れシナリオ

```gherkin
Scenario: 汎用呼び出しで19関数が1行wrapperになる
  Given callDashboard<Req, Res>(type, payload, validate?) が導入されている
  When 各API関数を汎用呼び出し経由に書き換える
  Then 各関数が1行のwrapperになり
  And トランスポート・検証ロジックが1箇所に集約される

Scenario: 特殊な返り値を持つ関数が無理に寄せられない
  Given ServiceResult 以外を返す関数（例: getSqliteStatus）が存在する
  When 汎用化の対象を選定する
  Then その関数は汎用呼び出しの対象外として明示される
```

## 受け入れ基準
- [ ] `callDashboard` 汎用ヘルパーが新設されている
- [ ] 単一パターンに収まるAPI関数が1行wrapperになっている
- [ ] 特殊形状の関数が対象外として明示されている
- [ ] 既存の `dashboardSqliteService.test.ts` 等がすべてパスする
- [ ] 型チェック（`npm run type-check`）が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard の各操作（検索・スター・削除・バックアップ等）が従来通り動作する

### 統合テスト
- 汎用呼び出し経由でも ServiceResult 契約・confirmToken要否（tokenExempt）が維持されること

### 単体テスト
- `callDashboard` の検証コールバック（不正応答・欠落フィールド）の境界
- 型レベルで Req/Res が保たれること（型チェック）

## 実装アプローチ
- **Outside-In**: 既存テストで19関数の挙動を固定してからwrapper化
- **Red-Green-Refactor**: 関数単位で置換し、グリーンを維持

## 見積もり
5pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（PBI-15「dashboard handler deps平坦化」とは別関心）
- 副作用: Dashboardの読み書き。ServiceResult契約と confirmToken要否（tokenExempt）を維持
- テスタビリティ: 汎用ヘルパーは型パラメータ化によりテスト容易

## 実装者向け注記

### 現状コードの確認
```bash
# 19関数のエクスポートを確認
grep -n "^export async function" src/dashboard/dashboardSqliteService.ts
# 送信・検証の共通パターンを確認
grep -n "sendDashboardMessage\|confirmToken\|ServiceResult" src/dashboard/dashboardSqliteService.ts | head -40
```

### 現状（2026-08-17 確認済み）
- `dashboardSqliteService.ts` 704行。19 export関数（`queryLogs`/`searchLogs`/`toggleStar`/`deleteLog`/`updateLog`/`migrateLogs`/`runOpfsSpike`/`clearAllLogs`/`getLogCount`/`getSqliteStatus`/`cleanupLegacyStorage`/`backfillMetadata`/`backupDb`/`restoreDb`/`importLogs`/`purgeOldRecordsNow`/`purgeContentNow`/`appendToLogs`/`queryAuditLogs`）
- `getSqliteStatus`（460行）は `ServiceResult` でない返り値。`isServiceError`（30行）が型ガード

### 実装手順
1. 既存テストで19関数の挙動を固定
2. `callDashboard<Req, Res>(type, payload, validate?)` を設計（総称・検証コールバックの型を確定）
3. 単一パターンに収まる関数を1行wrapperに置換
4. `getSqliteStatus` 等の特殊形状は対象外と明記
5. 型チェック・既存テストでグリーンを確認

### 落とし穴
- 全19関数が同一パターンではない（`getSqliteStatus` が非ServiceResult）。型を無理に寄せるより、明示的な例外分岐を残す
- confirmToken要否は `sqliteOperationSecurity.ts` の tokenExempt 免除リストで管理。汎用化でトークン要否が変わらないこと
- `runOpfsSpike`/`migrateLogs`/`restoreDb` 等はpayload形状が特殊な可能性。総称の境界で吸収できない場合は個別実装を残す

## Definition of Done
- [ ] `callDashboard` 汎用ヘルパーが新設されている
- [ ] 該当するAPI関数が1行wrapperになっている
- [ ] 特殊形状の関数が対象外として明示されている
- [ ] 既存のdashboardSqliteServiceテストがパスしている
- [ ] `npm run validate` が通過している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
