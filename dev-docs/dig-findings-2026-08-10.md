# Deep-Dig Findings — 2026-08-10

5 PBI実装計画の深掘りセッション。各PBIの隠れた仮定をwhy-why分析で顕在化し、設計判断を記録。

---

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| PBI-02の簡易版メソッド全削除 | 高 | 本番callerの使用状況が未調査。削除範囲を決定する前に調査が必要 | **調査先行**で進める |
| PBI-03のsingleton差異をそのままproduction組み込み | 高 | `getSharedSqliteClient`と`new SqliteClient()`のper-instance状態（Mutex/offscreenAlive）分裂リスク。PBI-03は2つの別問題を混在させていた | **PBI-03を分割** |
| PBI-04の応答型付けスコープ | 中 | 3アプローチ（完全型付け/共通shape/coercion集約）。SQLiteはクリティカルパスで、dashboard protocolが同じパターンを確立済み | **A: 完全型付け** |
| PBI実行順序 | 中 | 依存関係: PBI-04→PBI-02→PBI-01（SQLite chain底辺から上へ） | **05→03a→03b→04→02→01** |
| PBI-05の文字列→宣言移行 | 中 | 3対象stepと2 job種別は暗黙の契約。テストで挙動固定が必要 | **テスト固定→宣言化** |
| PBI-05 metadata設計 | 中 | 3オプション（単一field/分離field/ErrorStrategy拡張）。presence/absenceでenabled表現が最も简洁 | **A洗練版: `offlineRetry?: { jobKind }`** |

## 新たに発見したリスク

1. **PBI-03の2問題混在**: handler deps複製（context menu）とpipeline factory繰り返しは別問題。composition moduleのproduction組み込みは必須ではない
2. **PBI-04のoffscreen protocol進化履歴**: 型付けなしで進化し、callerごとのcoercionに依存。dashboard protocol（DashboardSqliteResponseFor）が同じパターンを既に確立
3. **PBI-05のoffline retry routing**: `offlineJobKind`はrouting keyであり、step固有設定よりjob routingに近い。再実行はpipeline全体
4. **PBI-02のテストハーネス影響**: RESULT_METHOD_SOURCES（14エントリ）削除で6ファイル以上のテストが影響を受ける

## 未解決の疑問

- PBI-02の本番caller調査結果（実装前に実施）
- PBI-04の20操作すべてに応答型を書く作業量（~400行の型定義+decoder）

## 決定事項

1. **PBI-02**: 本番callerの使用状況を完全に調査してから削除範囲を決定
2. **PBI-03**: 2件に分割 — 03a: handler deps複製解消、03b: pipeline factory集約。composition moduleのproduction組み込みは不要
3. **PBI-04**: アプローチA — 操作ごとの完全型付け+decoder（DashboardSqliteResponseForと同じパターン）
4. **実行順序**: PBI-05 → PBI-03a → PBI-03b → PBI-04 → PBI-02 → PBI-01
5. **PBI-05 metadata**: `offlineRetry?: { jobKind: 'obsidian_sync' | 'ai_summary' }` — presence/absenceでenabled表現
6. **PBI-05**: 既存挙動（3対象step、2 job種別）をテストで固定してから宣言化
7. **categorizeErrorの文言**: 変更しない（テスト契約）

---

## 補足: 20+ Whys分析の要約

### PBI-03 singleton差異（20回）
- 根本原因: `createBackgroundServices`はテスト容易性のために`new`で設計されたが、singleton制約を考慮していなかった
- 解決策: PBI-03を2つの独立問題に分割（handler複製解消 + pipeline factory集約）

### PBI-04 応答型付け（20回）
- 根本原因: offscreen protocolは型付けなしで進化し、callerごとのcoercionに依存
- 解決策: DashboardSqliteResponseForと同じパターンをoffscreen protocolに適用

### PBI実行順序（15回）
- 根本原因: SQLite chainの依存関係（offscreen→SqliteClient→dashboard）
- 解決策: 独立PBIを先に、SQLite chainを底辺から

### PBI-05 metadata設計（15回）
- 根本原因: オフラインリトライポリシーに2つの関心（リトライ可否 + job routing）が混在
- 解決策: `offlineRetry?: { jobKind }` — presence/absenceでenabled表現、TypeScriptがjobKindを強制
