# IdbVfsBackend のスカラ読みパターン ×16 の共通化（refactor）

## 1. タイトル + 種別

- **タイトル**: `IdbVfsBackend` に手書きされている単一セル読みパターン（let 初期化 + execWithCache コールバック代入）を `private async scalar(sql, params): Promise<number>` 1 本に共通化する
- **種別**: refactor（挙動不変・重複削減のみ）
- **見積もり**: 1 SP

## 2. 優先度

- **優先度**: 順位 5
- **RICE**: R4 / I1 / C1.0 / E1 → **4.0**
- **根拠**:
  - 単一セル読みの同じ手書きパターンがほぼ全メソッドに 16 箇所あり、count の読み方には `row[0]`（IDB）と `row.c`（worker）の 2 つの言い回しが併存している。過去の count 混線バグと同型の混乱をコード上に残し続ける状態
  - Confidence 1.0（コードで確定・改善案は機械的な共通化）だが Impact は中（重複削減・規範化）のため順位は NN04 の直後に配置
- **依存**: **NN04（purge sequence 統合）の着地後に `IdbVfsBackend.ts` を触ること**（同一ファイルの順序依存）。NN04 採用なら purge 系 8 箇所は `runPurgeSequence` に吸収されて同時に消えるため、本 PBI の対象範囲は着地後に確定する

## 3. ユーザーストーリー

**オフスクリーン SQLite バックエンドの保守担当者として**、単一セル読みが 1 つのヘルパーに集約されていてほしい。なぜなら、16 箇所に手書きされた同じパターンと 2 通りの count 読み言い回しがあると、変更時の書き漏れや count の混線が黙って通過するから。

## 4. 背景

「`let x = 初期値; await execWithCache(sql, params, row => { x = Number(row[0]) })`」の単一セル読みが `IdbVfsBackend` のほぼ全メソッドに手書きされている。count の読み方には `row[0]`（IDB）と `row.c`（worker）の 2 つの言い回しが併存しており、過去の count 混線バグと同型の混乱を残す。

該当箇所（16 箇所・全 file:line 検証済み）:

- `src/offscreen/IdbVfsBackend.ts:87-89`
- `src/offscreen/IdbVfsBackend.ts:102-104`
- `src/offscreen/IdbVfsBackend.ts:162-167`
- `src/offscreen/IdbVfsBackend.ts:197-203`
- `src/offscreen/IdbVfsBackend.ts:229-231`
- `src/offscreen/IdbVfsBackend.ts:234-239`
- `src/offscreen/IdbVfsBackend.ts:244-246`
- `src/offscreen/IdbVfsBackend.ts:260-264`
- `src/offscreen/IdbVfsBackend.ts:268-273`
- `src/offscreen/IdbVfsBackend.ts:277-280`
- `src/offscreen/IdbVfsBackend.ts:296-300`
- `src/offscreen/IdbVfsBackend.ts:306-312`
- `src/offscreen/IdbVfsBackend.ts:325-328`
- `src/offscreen/IdbVfsBackend.ts:350-353`
- `src/offscreen/IdbVfsBackend.ts:374-377`
- `src/offscreen/IdbVfsBackend.ts:401-407`

## 5. BDD シナリオ

### シナリオ 1: スカラ読みヘルパーが 1 本に統一される

```gherkin
Given IdbVfsBackend.ts に private async scalar(sql, params): Promise<number>（先頭セルの Number 化）が 1 本追加されている
When ファイル内の単一セル読みを確認する
Then 16 箇所すべてが scalar() 呼び出し 1 行に置き換えられていること
And 手書きの let 初期化 + execWithCache コールバック代入のパターンが残っていないこと
And Number 変換が scalar() 内に集約されていること
```

### シナリオ 2: 挙動が完全に不変である

```gherkin
Given リファクタリング前の SQL・パラメータ・戻り値の形状が pin されている
When scalar() 導入後に既存のバックエンドテストを実行する
Then すべてのテストが無変更（pin 部分のみ）で通過すること
And 単一セル読みの戻り値が Number 化された先頭セルである点がリファクタリング前と一致すること
```

### シナリオ 3: 依存関係が守られる

```gherkin
Given NN04（purge sequence 統合）が未着地である
When 実装順序を確認する
Then 本 PBI は NN04 の着地後に着手されていること
And NN04 着地後の purge 系 scalar 読み（~8 箇所が runPurgeSequence に吸収）を除いた残り箇所に対して共通化が適用されていること
```

## 6. 受け入れ基準

- [ ] `src/offscreen/IdbVfsBackend.ts` に `private async scalar(sql, params): Promise<number>`（先頭セルの Number 化）が 1 本追加されている
- [ ] 16 箇所（背景の file:line 列挙、NN04 着地後は purge 系を除いた残り箇所）のスカラ読みが `scalar()` 呼び出し 1 行に置き換えられている
- [ ] `Number` 変換が `scalar()` 内に集約され、呼び出しサイトから手書きの `Number(row[0])` コールバックが消えている
- [ ] 「let 初期化 + execWithCache コールバック代入」の単一セル読みパターンが `IdbVfsBackend.ts` 内に残っていない（grep で確認）
- [ ] 既存の parity pin（`sqliteBackendParity.realEngine.test.ts` など）が無変更で維持されている
- [ ] 挙動が完全に不変である（SQL・パラメータ・戻り値の変更なし、既存テスト全通過）

## 7. テスト戦略

1. **parity pin 先行**: 着手前に `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts` の pin（SQL・挙動の一致検証）を確認し、リファクタリング中も失敗しないことを安全網として使う
2. **既存バックエンドテストの green 維持**: `insertBatch-counting-parametric.test.ts`（`SELECT changes()` の counting）、`idb-migration.test.ts`、`offscreen-sqlite.test.ts` など `src/offscreen/__tests__/` のバックエンド系テストを無変更で通過させる。テスト側の pin 部分は変更しない
3. **残存パターンの grep 確認**: `Number(row[0])` コールバックと let 初期化パターンが `IdbVfsBackend.ts` から消えたことを grep で確認する
4. **validate green**: `npm run validate`（type-check + test）で全テスト通過を確認する

## 8. 見積もり

**1 SP** — 機械的な共通化（ヘルパー 1 本追加 + 16 箇所の 1 行化）のみでロジック変更なし。影響範囲は `IdbVfsBackend.ts` 1 ファイル（NN04 着地後に purge 系 8 箇所が範囲外になるため実質さらに縮小）

## 9. DoD

- [ ] 受け入れ基準 6 件すべて充足
- [ ] `npm run validate`（type-check + test）が green
- [ ] parity pin が無変更で通過
- [ ] `IdbVfsBackend.ts` 内に手書きの単一セル読みパターンが残っていない（grep で確認）
- [ ] NN04 の着地後に着手・完了している（同一ファイルの順序依存を遵守）
- [ ] 既存機能への影響ゼロ（挙動不変）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 5（R4 / I1 / C1.0 / E1 → 4.0）
- 依存: NN04（[2026-10-09-04-refactor-purge-sequence-ssot.md](2026-10-09-04-refactor-purge-sequence-ssot.md)）の着地後（`IdbVfsBackend.ts` 共有の順序依存。同点 4.0 の tie-break は NN04 先行）
