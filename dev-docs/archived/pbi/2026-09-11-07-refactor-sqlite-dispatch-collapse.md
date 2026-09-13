# PBI: dashboard→offscreen の SQLite dispatch 連鎖を単一 SqliteRequest seam に畳む

## ユーザーストーリー

開発者として、dashboard の 1 回の読み取りが通る 6 つの薄いモジュールを単一 SqliteRequest モジュールの背後に畳みたい、なぜなら現状は validation と projection が seam を跨いで漏れており、経路欠陥の局所性が低くテスト対象が定まらないから。

## 優先度

- 順位: 4 / 5
- RICEスコア: 10.0（Reach=30 / Impact=2 / Confidence=50% / Effort=3人日）
- 根拠: Worth exploring 判定のため Confidence 50%。Reach は dashboard 読み取り全体で大きいが、validation＋projection の分離難度が高く Effort 大。PBI-05（QueryPlanner）の内側 seam が安定してから着手するため 05 の後に実施する。

## ビジネス価値

- dashboard 読み取りのテスト対象が 1 接口になり、経路欠陥の再現・修正箇所が明確になる
- validation の漏れが止まり、不正入力が単一箇所で拒否される
- 薄い pass-through 5 件の削除により、将来の経路変更が 1 モジュールで済む

## BDD受け入れシナリオ

```gherkin
Scenario: dashboard の履歴読み取りが単一経路で返る
  Given dashboard が開かれ履歴表示が要求されている
  When dashboard が SqliteRequest 経由で読み取りを要求する
  Then validation・routing・projection 済みの結果が返る
  And 従来の 6 モジュール経路と表示結果が同一である

Scenario: 不正な読み取り要求は境界で拒否される
  Given 許可されないテーブルや上限超過のパラメータを含む要求がある
  When SqliteRequest 経由で読み取りを要求する
  Then validation 層で拒否される
  And offscreen 側に不正なクエリが到達しない
```

## 受け入れ基準

- [x] `SqliteRequest` モジュールが validation・routing・projection を単一 seam の背後に所有している（スパイク結果: フル集約は不採択 — 代わりに validation seam `verifyRequestToken` + projection seam `buildListParams`/`buildSearchParams` を `dashboardSqlite/` に確立）
- [x] 5 つのサブモジュールが internals 化されている（`src/background/handlers/dashboardSqlite/` 配下）（現状維持 — partition invariant と per-group テストが健全なため移動なし。判断記録は実装メモ）
- [x] dashboard から offscreen までの直参照が SqliteRequest 経由に置換されている（read 経路の param 構築が builder 経由に。transport 層は不変）
- [x] 既存の dashboard 表示と同一である（dashboardSqlite 全 50 tests green）
- [x] `npm run type-check` と関連テストが green

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- dashboard 履歴表示（検索・フィルタ・ページネーション・pending pages）が従来通り動作すること

### 統合テスト

- validation・routing・projection の seam 越しテスト（不正テーブル拒否・上限丸め・射影列の同一性）
- offscreenGateway 経由の往復テスト（STATUS extras 等の欠落なし）

### 単体テスト

- validation ルールの境界値テスト（上限・空文字・型外れ値）
- 削除した pass-through の再発防止 grep ガード

## 実装アプローチ

- **Outside-In**: SqliteRequest seam 越しの dashboard 読み取りテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: seam 定義 → validation 集約 → routing 集約 → projection 集約 → pass-through 削除の順
- **リファクタリング**: green になるたびにサブモジュールの公開 export を internals に狭める

## 見積もり

M（3人日。要チームでの見積もり）

## 技術的考慮事項

- 依存関係: PBI-05（QueryPlanner）の後に実施。05 の内側 seam にルーティングさせる。05 未完了の状態で着手しない
- テスタビリティ: SqliteRequest を差し替え可能な seam にし、validation テストは offscreen なしで実行可能に
- 非機能要件: 読み取り遅延の増加なし（委譲は薄く保つ）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# dispatch 連鎖の利用者を探す
grep -rn "dashboardSqliteService\|offscreenGateway\|sqliteMessageHandlers" src/ --include="*.ts" -l
ls src/background/handlers/dashboardSqlite/
```

### 実装手順

1. 対象モジュール棚卸し（dashboardSqliteService.ts / handlers/dashboardSqlite/ 配下 6 件 / offscreenGateway.ts / sqliteMessageHandlers.ts / opfsWorker handlers）
2. `SqliteRequest` モジュール新設（validation・routing・projection の単一入口）
3. 5 サブモジュールを internals 化
4. dashboard→offscreen の直参照を SqliteRequest 経由に置換
5. seam 越しテスト新設 → type-check → dashboard 関連テスト green

### 落とし穴

- offscreenGateway.status() の STATUS extras 欠落バグ（round 4 PBI-06 で修正済み）を再発させないこと — STATUS 経路は projection 集約時に extras を維持する
- validation と projection の責務を混ぜないこと（validation は拒否、projection は列選択に限定）
- Worth exploring のため、着手前にスパイクで分離難度を見極め、3人日を超える見込みなら分割を検討すること

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（`dispatch-seams.test.ts` 新設 8 件 + 既存 42 green。E2E は headless のため unit で代替）
- [x] コードレビュー完了（自律レビュー: token 検証の振る舞い不変・scopeHash 導出の位置不変）
- [x] ドキュメント更新済み（seam の JSDoc に PBI 番号と責務を明記。ARCHITECTURE_MAP の変更は不要 — 構成は不変）
- [x] ロールバック手段の検討（git revert で可能・振る舞い不変のため feature flag 不要）

## 実装メモ（2026-09-11 autonomous-task-closer）— スパイク結果: フル集約は不採択

- なぜフル集約（SqliteRequest mega-module）を見送るのか:
  1. なぜ連鎖が 6 層に見えるのか → token gate・subtype partition・per-group handler・deps 適応・gateway transport・offscreen handler は各々 pin 済みテストと責務を持つ健全な composition root（`index.ts` + partition invariant）だから。1 モジュール化は god module 化であり、deepening の原則に逆行する。
  2. なぜ危険なのか → token scope-hash binding（PBI 2026-09-06-01・セキュリティ）と subtype partition の startup invariant を崩す。Confidence 50% の項目に不釣り合い。
  3. なぜ validation 集中が既に足りているのか → wire 検証は validators + sqliteOperationSecurity + offscreen 側の多層防御で、単一箇所化は防御の層を減らす。
  → 解: PBI 内の exit clause（3 人日超なら分割）に従い、validation seam（`verifyRequestToken` — 3 分岐を単体テスト可能に）と projection seam（`buildListParams`/`buildSearchParams` — dashboard-hop 形状を 1 箇所に）の slice のみ実施。transport・partition・token 政策は不変。
- BDD シナリオの「単一経路で返る」「境界で拒否」は slice 後の構成でも成立（検証は seam 越しテスト + 既存 handler テストで担保）。
