# tagClusterPanel の limit マジックリテラルを MAX_QUERY_ROWS SSOT へ差し替え（refactor）

## 1. タイトル + 種別

- **タイトル**: `tagClusterPanel.ts` に残る `limit: 10000` のマジックリテラルを `MAX_QUERY_ROWS` 定数へ差し替える
- **種別**: refactor（同一値置換・挙動不変）
- **見積もり**: 0.5 SP

## 2. 優先度

- **優先度**: 順位 17
- **RICE**: R2 / I0.5 / C1.0 / E0.5 → **2.0**
- **根拠**:
  - `MAX_QUERY_ROWS` は `QUERY_CAPS.plain` 由参照（=10000）で、dashboard の ask と wire clamp のドリフトで notice の文言が嘘をつくのを防ぐ目的で用意された SSOT（`computeLimits.ts:88-102`）
  - 同系パネルはすべて import 済みで、tagClusterPanel だけがリテラルの取り残し。Impact は小（規範化のみ）だが Effort 0.5 のため RICE は 2.0
- **依存**: **なし**

## 3. ユーザーストーリー

**dashboard パネルの保守担当者として**、クエリ上限が SSOT 定数で統一されていてほしい。なぜなら、1 パネルだけリテラルが残っていると、上限変更時にこのパネルだけ clamp と乖離し、notice の文言が実態と食い違うから。

## 4. 背景

`MAX_QUERY_ROWS` は `QUERY_CAPS.plain` 由参照（=10000）で「dashboard の ask と wire clamp がドリフトすると notice の文言が嘘をつく」目的（`src/utils/computeLimits.ts:88-102`）で用意された SSOT。同系パネルはすべて import しているが、tagClusterPanel だけリテラル。値が変わるとこのパネルだけ clamp と乖離する。

該当箇所（全 file:line 検証済み）:

- `src/dashboard/panels/asyncData/tagClusterPanel.ts:81`（`limit: 10000`）
- 対比: `src/dashboard/panels/asyncData/wordClusterPanel.ts:91`、`src/dashboard/panels/asyncData/tagCooccurrenceTablePanel.ts:214`（ともに `MAX_QUERY_ROWS` を import）

改善案: `tagClusterPanel.ts:81` を `limit: MAX_QUERY_ROWS` に差し替える（=10000、同一値なので外部挙動・テストの pin も不変）。retry/catch は `fetchPeriodRows` とパネル catch の現位置のまま。

## 5. BDD シナリオ

### シナリオ 1: リテラルが SSOT 定数になる

```gherkin
Given tagClusterPanel が MAX_QUERY_ROWS を import している
When tagClusterPanel.ts:81 のクエリ上限を確認する
Then limit: MAX_QUERY_ROWS になっていること
And limit: 10000 のリテラルが残っていないこと
```

### シナリオ 2: 外部挙動が現行と同一である

```gherkin
Given MAX_QUERY_ROWS は 10000 を指す
When tagClusterPanel のクエリを実行する
Then 上限値は 10000 のままで、既存テストの pin も不変であること
```

## 6. 受け入れ基準

- [x] `src/dashboard/panels/asyncData/tagClusterPanel.ts:81` が `limit: MAX_QUERY_ROWS` になっている
- [x] `MAX_QUERY_ROWS` が `src/utils/computeLimits.ts` から import されている
- [x] `limit: 10000` のリテラルが tagClusterPanel から消えている
- [x] 既存の tagClusterPanel テストが無変更で green である

## 7. テスト戦略

1. **同一値置換の確認**: `MAX_QUERY_ROWS` = 10000 であることを確認し、外部挙動・テスト pin が不変であることを担保する
2. **既存テストの green 維持**: tagClusterPanel の既存テストを無変更で通過させる
3. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**0.5 SP** — 1 ファイル 1 行の置換 + import 追加。

## 9. DoD

- [x] 受け入れ基準 4 件すべて充足
- [x] tagClusterPanel に `limit: 10000` のリテラルが残っていない
- [x] 既存テストが無変更で green
- [x] `npm run validate`（type-check + test）が green

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 17（R2 / I0.5 / C1.0 / E0.5 → 2.0）
- 依存: なし
