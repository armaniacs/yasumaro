# PBI 01: 上限定数の SSOT 化 — limits テーブル新設で 4 authorities の drift を解消

## ユーザーストーリー

ダッシュボードから SQLite を操作する利用者として、どの経路（validator / handler / dashboard 事前チェック）を通っても同じ上限が適用されてほしい。なぜなら現状は `MAX_IMPORT_ROWS` が 1000（validator）/ 5000（handler）/ 100,000（dashboard 事前チェック）に分裂し、validator を迂回する直接呼び出しが 5 倍の行を通す fail-open の形になっているから。

## 優先度

- 順位: 01 / 6
- RICE スコア: 24.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.2 人週）
- 根拠: 検証境界の drift が実在（import 3 値・append 2 値）し、diff が小さく機械的なため Confidence 高。意図的分歧（audit 1000 vs 100000）は名前付き変種として保持するだけ。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: なし。ただし 02（update whitelist）が deps.ts / validators.ts を共有するため 01 を先に着地させる。

## BDD 受け入れシナリオ

```gherkin
Scenario: import 行数上限が全経路で同一
  Given limits.ts に MAX_IMPORT_ROWS が 1 個だけ定義されている
  When  dashboard 事前チェック / validators / maintenanceBatchHandler のそれぞれで
        上限を参照する
  Then  3 経路とも同一の定数値を使用し、handler 側の 5000 と validator 側の 1000 という
        値の不一致は存在しない

Scenario: 意図的な分歧は名前付き変種として残る
  Given audit の上限が OPFS worker は 1000、IdbVfsBackend は 100000 という意図的分歧を持つ
  When  limits.ts を確認する
  Then  両者は名前付き定数（例: AUDIT_CAP_OPFS / AUDIT_CAP_IDB）として定義され、
        分歧の理由がコメントで記録されている

Scenario: 上限超過リクエストの挙動は現行と同一
  Given MAX_APPEND_IDS を超える ids 配列を送信する
  When  update/append 系サブタイプが処理される
  Then  拒否される（現行のエラー形を維持）。緩和・厳格化の振る舞い変更はしない
```

## 受け入れ基準

- [ ] `src/messaging/limits.ts`（または合意位置）に上限テーブルを新設: `MAX_IMPORT_ROWS` / `MAX_APPEND_IDS` / `QUERY_CAPS`（参照移管）/ `ARCHIVE_CHUNK_BYTES` / `RESTORE_BYTES` 等
- [ ] `deps.ts:9-13` の `MAX_APPEND_IDS` / `MAX_IMPORT_ROWS`、`validators.ts:42-59` の `VALIDATOR_LIMITS` 内の重複値、`importLogsService.ts:31` の `100_000`、`maintenanceBatchHandler.ts:33-34` の再定義を import に寄せる
- [ ] `readOnlyHandler.ts` の clampLimit リテラル（1000/100000/1000）が `QUERY_CAPS` 参照になる
- [ ] 意図的分歧（audit OPFS 1000 vs IDB 100000）は名前付き定数 + 理由コメントとして保持
- [ ] 振る舞い変更なし（上限値の緩和・厳格化をしない。値の統一が必要な場合は drift のどちらが正かを実装メモに記録してから統一）
- [ ] drift 検出テスト 1 本（同一概念の複数定義が再発したら fail する形、または limits.ts 参照の整合テスト）

## テスト戦略

- 単体: limits テーブルの整合テスト（validator の制限値と handler の制限値が同一ソースを参照すること）
- 回帰: 既存の上限超過テスト（validators-limits / dashboardSqliteHandlers-extra 等）が無修正で green であること（挙動不変の証明）

## 実装アプローチ

1. `limits.ts` を新設（中立位置。`messaging/` なら messaging/validators・offscreen 双方から import 可能）
2. 定数を移管し、各 authority を import に寄せる（値は現行の実効値 = 最厳値を保持）
3. 意図的分歧に名前を付ける
4. drift 検出テスト追加

## 見積もり

0.2 人週。難易度: 🟢低。副作用: 🟢なし（挙動不変）。種別: 🔧非機能追加（fix）。

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] type-check / lint / 対象テスト green
- [ ] コードレビュー完了
- [ ] `2026-09-05-00-backlog-future.md` の該当行（あれば）と `00-INDEX.md` を更新
