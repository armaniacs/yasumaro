# PBI: sqliteQueryBuilder の order-dir 正規化 3 重を resolveOrderDir に畳む

- 種別: refactor
- RICE: 8.0（R4 × I1 × C1.0 / E0.5）
- 依存: なし
- バッチ: W1

## ユーザーストーリー

保守担当者として、order-dir の正規化と許容方向検査が 1 箇所にあってほしい。なぜなら許容方向セット（ASC/DESC）を変える変更が 3 ファイルではなく 1 ファイルの 1 箇所で済むべきだから。

## 背景（現状）

- `src/offscreen/sqliteQueryBuilder.ts:86-89` — `buildOrderByClause`: `const dir = (q.orderDir || 'DESC').toUpperCase(); if (!ALLOWED_ORDER_DIRECTIONS.includes(...)) return { orderClause: '', error: ... }`
- `src/offscreen/sqliteQueryBuilder.ts:99-102` — `buildFts5OrderClause`: 同一ブロック
- `src/offscreen/sqliteQueryBuilder.ts:113-116` — `buildLikeOrderClause`: 同一ブロック

同一の 4 行ブロックが同一ファイル内に逐語 3 回。クローズ済み「SEARCH_COLUMNS drift」ではなく order-dir 正規化の側の DRY 摩擦。

## BDD 受け入れシナリオ

```gherkin
Scenario: 許容方向の変更が 1 箇所で完結する
  Given resolveOrderDir が order-dir 正規化の唯一の所有である
  When 許容方向セットに 'ASC' / 'DESC' 以外を追加する変更を入れる
  Then 変更点は ALLOWED_ORDER_DIRECTIONS と resolveOrderDir の 1 箇所のみである

Scenario: 各ビルダーの wire 結果は変更前と同一
  Given orderDir が 'desc'（小文字）/ undefined / 不正値 の各入力
  When buildOrderByClause / buildFts5OrderClause / buildLikeOrderClause を呼ぶ
  Then 結果は変更前と同一（大文字正規化・既定 DESC・不正時 error）
```

## 受け入れ基準

- [x] `resolveOrderDir(q: StorageQuery): { dir: string; error?: undefined } | { dir?: undefined; error: string }` を抽出する
- [x] 3 ビルダーから逐語ブロックを削除し、ヘルパー呼び出しに置換
- [x] 既存テストが green（wire 結果不変）
- [x] `ALLOWED_ORDER_DIRECTIONS` の参照箇所が 1 ファイル 1 箇所に集約

## テスト戦略

- unit: `src/offscreen/__tests__/` の既存 sqliteQueryBuilder テストが green（挙動不変）
- 境界値: 不正 orderDir の error 経路は既存テストで担保
- 挙動不変: 正規化・既定値・error 形式は変更しない

## 見積もり

0.5 SP

## 技術的考慮事項

- 挙動不変のリファクタリング（抽出のみ）
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `resolveOrderDir` を抽出（:86-89 のブロックを移設、error 形式は既存どおり `Invalid orderDir: ${dir}`）
2. 3 ビルダーを置換 → `npx vitest run src/offscreen` で検証

### 落とし穴

- 3 ビルダーの error 戻り値形状（`{ orderClause: '', error: ... }`）は不変

## Definition of Done

- [x] order-dir 正規化の実装箇所が 1 箇所のみ
- [x] `npx vitest run src/offscreen` が green
- [x] ロールバック不要（挙動不変の抽出）
