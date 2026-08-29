# PBI: SQLite クエリ limit の両側クランプ統一（VULN-017/021/048/049, CWE-400）

## ユーザーストーリー
開発者として、DASHBOARD_SQLITE の読み取り系で負の limit や非有限値が LIMIT 句に届かないようにしたい、なぜなら SQLite は負の LIMIT を「無制限」と解釈し、`Math.min` のみの clamp を素通しして監査ログ・閲覧履歴全件が materialization されるから

## ビジネス価値
- 4 シンクの解消: handler（query/search/audit_log_query）、queryPlan、recordsRepo、IdbVfsBackend
- 実証: `LIMIT -1` で 50 万行 materialization、`audit_log` 全件流出
- 測定方法: `limit: -1 / 0 / 0.5 / 1e9` の 4 値が全シンクで [1, cap] にクランプされること

## 優先度
- 順位: 5 / 14
- RICEスコア: 1330（Reach=400 / Impact=0.35 / Confidence=95% / Effort=0.1人月）
  - Reach 400: DASHBOARD_SQLITE は extension-only（dashboard XSS やローカル操作者）に限定
  - Impact 0.35: 無制限 materialization による情報一括露出＋SW 負荷
  - Confidence 95%: clamp 1 行系の修正。境界値テストで完全固定可能
  - Effort 0.1: queryPlan＋handler の統一 clamp＋4 シンクのテスト
- 根拠: ADR 2026-08-27-limit-policy の QuerySpec 集約に下限追加を足すだけで完結。スイープで 8 サイト中 6 が候補、2 は正当緩和済み

## BDD受け入れシナリオ

```gherkin
Scenario: 負の limit は既定値にクランプされる
  Given ダッシュボードが payload { limit: -1 } を送る
  When query / search / audit_log_query のいずれかを実行する
  Then LIMIT は cap 内の正値になり、無制限 materialization は発生しない

Scenario: 非有限値は既定値にフォールバックする
  Given payload { limit: 0.5 } または { limit: 1e9 } が送られる
  When 読み取りを実行する
  Then limit は Number 変換＋clamp により [1, cap] に収まる

Scenario: 通常の limit は現行どおり動作する（回帰防止）
  Given payload { limit: 50 } が送られる
  When query を実行する
  Then 現行と同一の 50 行が返る

Scenario: engine 直呼び（recordsRepo）でも下限が強制される
  Given recordsRepo に limit: -1 が渡る
  When クエリが組まれる
  Then queryPlan レベルの clamp により正値に正規化される
```

## 受け入れ基準
- [ ] `src/offscreen/queryPlan.ts:78-80` が `Math.max(1, Math.min(...))` の両側クランプになる
- [ ] `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:27,45,80` が信頼境界で両側クランプ（非有限は既定 100/50/1000 にフォールバック）する
- [ ] `src/offscreen/opfsWorker/auditHandlers.ts:27` と `src/offscreen/IdbVfsBackend.ts:371` が同様の下限を持つ
- [ ] `src/offscreen/recordsRepo.ts:44` が下限強制される
- [ ] 境界値テスト（-1/0/0.5/1e9/正常値）が 4 シンクで追加される
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: `Math.min(…limit` のみのパターンが読み取り系で 0 件

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（handler＋engine の単体/統合で十分）

### 統合テスト
- `createDashboardSqliteHandler` 経由: 4 種の異常 limit で読み取りが既定値クランプされ成功すること（エラーではなく正常系）

### 単体テスト
- 新規: `src/offscreen/__tests__/queryPlanClamp.test.ts`（queryPlan の境界値）
- 更新: `auditHandlers`/`IdbVfsBackend`/`recordsRepo` の既存テストに負値ケース追加

## 実装アプローチ
- **Outside-In**: handler 統合テストを Red（-1 が素通し）→ clamp 実装で Green → engine 側も同様
- **Red-Green-Refactor**: clamp ヘルパーを queryPlan に 1 本置き、各所から呼ぶ（重複実装を増やさない）

## 見積もり
1pt（要チームでの見積もり — clamp ヘルパー＋4 シンク＋テスト）

## 技術的考慮事項
- 依存関係: なし（Wave 1 推奨）
- テスタビリティ: 純粋関数化されているため境界値テストが容易
- 非機能要件: 既定値（100/50/1000/10000）と cap 値の変更なし
- 注意: `FallbackStorage.ts:256` の `slice(offset, offset+limit)` は JS slice セマンティクスで負値が安全（スイープ済み）— 触れない

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "Math\.min\(.*limit" src --type ts -g '!**/__tests__/**'
sed -n '74,84p' src/offscreen/queryPlan.ts
sed -n '24,30p' src/background/handlers/dashboardSqlite/readOnlyHandler.ts
```

### 実装手順
1. queryPlan に `clampLimit(raw, cap, fallback)` を新設
2. handler 3 箇所・auditHandlers・IdbVfsBackend・recordsRepo から呼ぶ
3. 境界値テスト追加、`npm run validate`

### 落とし穴
- `Math.floor(Number(payload.limit)) || fallback` を忘れると `0.5` が `0` → `Math.max(1,…)` で 1 になるが、既定値意図（100）とズレる。仕様は「非有限/非正は既定値」として handler で先に正規化すること
- audit 系の cap（1000）と records 系（MAX_QUERY_LIMIT）は別 cap — 統一しないこと（既存 ADR の LIMIT 2 種温存方針）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-017/021/048/049 が解消されること
