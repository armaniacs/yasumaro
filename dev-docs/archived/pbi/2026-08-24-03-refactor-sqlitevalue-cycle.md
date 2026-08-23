# PBI: SqliteValue 型の重複定義を統一し sqliteEngineContext の循環 import を解消する

## ユーザーストーリー

開発者として、`src/offscreen/sqliteEngineContext.ts` と `src/offscreen/sqliteEngine.ts` の間にある `SqliteValue` 型の重複定義を解消し、`sqliteEngineContext → idbEngineLifecycle → sqliteEngineContext` の循環 import を除去したい。なぜなら、重複した型定義は保守時の更新漏れを招き、循環依存はビルドの不安定性とコードの可読性を損なうから。

## 優先度

- 順位: 03 / 03
- RICE スコア: 80（Reach=8 / Impact=2 / Confidence=100% / Effort=0.2）
- 根拠: 型の重複と循環 import は技術的負債。変更範囲は `src/offscreen/` に閉じており、低リスク。

## BDD 受け入れシナリオ

```gherkin
Scenario: リファクタリング後も既存テストがすべて通る
  Given すべての既存テストが現在の main で PASS している
  When SqliteValue 型を sqliteEngine.ts に集約し、sqliteEngineContext.ts からは re-export する
  Then `npm run type-check` と `npm run test` と `npm run build` がすべて PASS する

Scenario: 循環 import が除去される
  Given graphify update . で Import Cycles が検出されている
  When SqliteValue の import 元を sqliteEngineContext.js から sqliteEngine.js に変更する
  Then `graphify update .` 後の GRAPH_REPORT.md に `sqliteEngineContext → idbEngineLifecycle → sqliteEngineContext` の循環が含まれない
```

## 受け入れ基準

- [x] `SqliteValue` 型が `src/offscreen/sqliteEngine.ts` のみで定義されている
- [x] `src/offscreen/sqliteEngineContext.ts` は `SqliteValue` を `sqliteEngine.js` から re-export し、自身では定義しない
- [x] `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts` が `SqliteValue` を `../sqliteEngine.js` から import する
- [x] `src/offscreen/sqliteEngineContext/migrationBackup.ts` が `SqliteValue` を `../sqliteEngine.js` から import する
- [x] `src/offscreen/sqliteQueryBuilder.ts` が `SqliteValue` を `./sqliteEngine.js` から import する
- [x] `src/offscreen/recordsRepo.ts` が `SqliteValue` を `./sqliteEngine.js` から import する
- [x] `src/offscreen/IdbVfsBackend.ts` が `SqliteValue` を `./sqliteEngine.js` から import する（`SqliteEngineContext` は sqliteEngineContext.js のまま）
- [x] `npm run type-check` が PASS する
- [x] `npm run test` が PASS する
- [x] `npm run build` が PASS する
- [x] `graphify update .` 後、該当 Import Cycle が検出されない

## テスト戦略（t_wada スタイル）

### 統合テスト
- 既存の `sqliteEngineContext` 関連テストがリグレッションしないことを確認

### 単体テスト
- なし（純粋な型移動のため）

### 静的検証
- `npm run type-check` で型の整合性を確認
- `graphify update .` で Import Cycle の減少を確認

## 実装アプローチ

1. `src/offscreen/sqliteEngineContext.ts` から `export type SqliteValue = ...` の定義を削除
2. `src/offscreen/sqliteEngineContext.ts` に `export { SqliteValue } from './sqliteEngine.js';` を追加し後方互換を維持
3. 子モジュールの import 元を `../sqliteEngineContext.js` から `../sqliteEngine.js`（または `./sqliteEngine.js`）に変更
4. `npm run type-check` → `npm run test` → `npm run build` を順に実行
5. `graphify update .` を実行し、Import Cycle が消えたことを確認

## 見積もり

1 ポイント（1時間未満）

## 技術的考慮事項

- `sqliteEngine.ts` と `sqliteEngineContext.ts` で `SqliteValue` の定義は実質同じ（`Array<number>` と `number[]` の表記違いのみ）。`sqliteEngine.ts` を正規の来源とする
- `sqliteEngineContext.ts` は `sqliteEngine.ts` から `SqliteEngine` をすでに import しているため、追加の循環は生じない
- re-export により既存の外部呼び出し側を一括修正せず済む

## 実装者向け注記

### 変更対象ファイル
```bash
grep -rn "SqliteValue" src/offscreen/ --include="*.ts"
```

### 落とし穴
- `Array<number>` と `number[]` は TypeScript 上同義だが、他の箇所で brand 型や厳密な互換性チェックを使っている場合は要注意（今回は該当なし）
- `sqliteEngineContext.ts` から `SqliteValue` の定義を削除するだけで、子モジュールの import が壊れないように注意

## Definition of Done

- [x] 全 BDD シナリオが自動テストまたは検証コマンドで満たされる
- [x] `npm run type-check` が PASS
- [x] `npm run test` が PASS
- [x] `npm run build` が PASS
- [x] `graphify update .` 後に該当 Import Cycle が含まれない
- [x] 変更ファイルを個別に `git add` してコミット
