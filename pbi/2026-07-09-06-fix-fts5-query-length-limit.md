# PBI: FTS5 tagFilter クエリに長さ制限を設ける

## ユーザーストーリー
保守開発者として、FTS5 の `tagFilter` クエリに長さ制限を設けたい。なぜなら現状はクエリ長の検証がなく、極長のタグフィルタ文字列が OPFS Worker へ送られ、パース・照合コストや潜在的な ReDoS リスクになるから。

## ビジネス価値
- 検索クエリ経路のリソース消費と安定性リスクを低減する
- 入力検証の欠落を塞ぐ

## 既実装確認（Phase 0）
- `grep -rn "tagFilter" src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts` → 長さ制限なしを確認
- **実装状態**: Checking Team Wave 3（2026-07-09）で既に修正済み（200 文字でトランケート・二重防御）・テスト追加済み（未コミット）。本 PBI は回帰仕様として記録

## BDD受け入れシナリオ

```gherkin
Scenario: 長すぎる tagFilter は切り詰められる
  Given ユーザーが 250 文字の tagFilter を入力した
  When query() が呼び出される
  Then tagFilter は 200 文字にトランケートされて OPFS Worker / IDB に渡される

Scenario: 短い tagFilter はそのまま通過する
  Given ユーザーが "javascript" という tagFilter を入力した
  When query() が呼び出される
  Then フィルタは変更されずに渡される
```

## 受け入れ基準
- [ ] `query()` エントリで `tagFilter` を `FTS_QUERY_MAX_LENGTH`(200) でトランケートしてから OPFS Worker プロキシ・IDB 両パスに渡す
- [ ] `opfsWorker.ts` の `handleQuery()` でも同様にトランケート（二重防御）
- [ ] 回帰テスト `sqlite-tagfilter-length.test.ts` がパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/offscreen/__tests__/sqlite-tagfilter-length.test.ts`（既存）:
  - 250 文字 → 200 文字にトランケート
  - 短い値（"javascript"）→ そのまま

### 統合テスト
- OPFS Worker パスでも同様のトランケート

## 見積もり
1 pt（既実装、回帰テストのみ確認）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 文字列長の境界値テストで検証

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "tagFilter" src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts
# → 長さ制限なし（修正前）
```
修正済み箇所: `sqlite.ts:710`（query エントリ）、`opfsWorker.ts:405`（handleQuery）。
定数: `FTS_QUERY_MAX_LENGTH = 200`。
テスト: `src/offscreen/__tests__/sqlite-tagfilter-length.test.ts`（2 tests）。

### 実装手順
- Wave 3 で適用済み。未コミットのため完了時に該当差分をコミット対象に含める。

### 落とし穴
- トランケートによる検索漏れ（200 文字超のタグ名は事実上存在しないため実害なし）を CHANGELOG で言及してよい

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載
