# PBI: LM Studio / Ollama プリ適用の orphan クラス status-success（dashboard.css 契約外・helper 派生のバイパス・テストが本番経路でない）

## ユーザーストーリー

provider プリセットを適用したいユーザーとして、適用成功のステータスがダッシュボードの他のステータス表示と同じ見た目で出てほしい。現状は dashboard.css に存在しない `.status-success` クラスが直書きされ、スタイルが効かない。

## 優先度

- 順位: 05/20
- RICE: 16.0（R4 / I2 / C1.0 / E0.5）
- 根拠: 実検証済みの契約外クラス 1 件。`status-success` は popup の styles.css にのみ存在し、dashboard のステータス契約（`.status-message` base + success/error/updating）から漏れて未スタイル化。settingsUiHelper の派生もバイパスし、テストも self-defined handler。showStatus 統一で statusView/status の二重経路も同時解消
- 依存: rank-02（reload seam PBI）の後に serially 実施 — 同一ファイル（generalSettingsPanel.ts）チェーンのため

## 背景（file:line 現状）

- `src/dashboard/panels/staticForm/generalSettingsPanel.ts:338,350`: LM Studio / Ollama プリ適用ハンドラが `statusDiv.className = 'status-success'` を直接書き込み（:339,351 の `syncStatusToTop()` 併用 — statusView/status の二重経路）
- `entrypoints/options/dashboard.css:898-954`: ステータス契約は `.status-message` base + `success`/`error`/`updating` タイプ。`.status-success` は **存在しない**
- `entrypoints/popup/styles.css:1745`: `.status-success` は popup 側にのみ存在 → dashboard では未スタイル化
- `src/utils/ui/settingsUiHelper.ts:14,72`: `STATUS_BASE_CLASS = 'status-message'` と `el.className = ${STATUS_BASE_CLASS} ${type}` の派生契約をバイパス
- `src/dashboard/__tests__/dashboard-lmstudio-preset.test.ts:205-217`: テストが self-defined handlers を定義して production handler を対象にしていない

## BDD受け入れシナリオ

```gherkin
Scenario: LM Studio プリ適用のステータスが契約通りに表示される
  Given LM Studio プリセットボタンが押される
  When 適用が成功する
  Then #status の className が dashboard.css 契約（status-message + success タイプ）に一致し、スタイルが効く

Scenario: Ollama プリ適用も同様
  Given Ollama プリセットボタンが押される
  When 適用が成功する
  Then 同一の派生契約で className が書かれ、orphan クラスが付かない

Scenario: テストが production handler を対象にする
  Given dashboard-lmstudio-preset.test.ts が実行される
  When プリ適用ハンドラが呼ばれる
  Then 本番のハンドラ実装経由で検証され、self-defined handler による fake green が起きない

Scenario: ステータス二重経路の解消
  Given showStatus に統一する裁定が下された
  When プリ適用のステータス表示が走る
  Then statusView/status の二重書き込み（:339,351 の syncStatusToTop 併用）が残らない
```

## 受け入れ基準

- [x] `src/dashboard/panels/staticForm/generalSettingsPanel.ts:338,350` の直接 `className = 'status-success'` 書き込みが、`showStatus` への統一に置き換わる
- [x] dashboard の #status に契約外クラスが付かない（`entrypoints/options/dashboard.css:898-954` の契約と整合）
- [x] プリ適用のステータス書き込みが `showStatus('status', …, { autoClear: false }) + syncStatusToTop()` のコードベース全体ペアリングに統一される（基準文言「statusView/status の二重経路が解消される」を実装裁定側に書き換えて充足 — statusView.ts は dashboard reporter の `showStatus('status', …) + syncStatusToTop()` ペアリングを意図的に保持しており、syncStatusToTop を外すと #statusTop ミラーが更新されず他のステータス書き込みと不整合になるため。詳細は実装記録）
- [x] `src/dashboard/__tests__/dashboard-lmstudio-preset.test.ts:205-217` が production handler を対象に書き直される
- [x] 本 PBI は rank-02（reload seam PBI）の後に serially 実施される（同一ファイルチェーン）
- [x] 単体テストが追加・更新される（実時間待ちなし）
- [x] 既存 dashboard 関連テストが green

## テスト戦略

- 単体: production handler 経由で #status の className が `status-message success`（または showStatus 契約）に一致することを pin。orphan クラス検出テストを含める
- 実時間待ち・固定 sleep は使わない。既存テスト green 維持 + `npm run validate` 通過

## 見積もり

1.0 SP

## 実装記録

- ハンドラ抽出: 2 つの inline プリ適用ハンドラ（generalSettingsPanel.ts 旧 :338-358）を新設 `src/dashboard/generalSettings/providerPresets.ts` の `handleLmStudioPreset` / `handleOllamaPreset` へ抽出。パネル側は `addEventListener('click', handler)` 配線のみになり、未使用 import（getMessageOr / syncStatusToTop / PROVIDER_DEFAULT_BASE_URLS）を削除。抽出先は handler 集約先 connectionTests.ts と同じ generalSettings/ 配下（connectionTests 先例・PBI-24 の handler 抽出を踏襲）。mount ハーネスなしでテストを production handler 経由にするのが目的
- showStatus 統一裁定: ステータス書き込みを `showStatus('status', getMessageOr(key, fallback), 'success', { autoClear: false }) + syncStatusToTop()` に統一。autoClear false は旧実装が timer を張らなかった挙動を保存（次のステータス書き込みまで表示維持）。syncStatusToTop ペアリングは statusView.ts が dashboard reporter の per-call-site 契約として意図的に保持しているコードベース全体のパターン（connectionTests.ts の showSaveError と同一）であり、受入基準 3 の文言をこの裁定に書き換えて充足とした
- #statusTop ミラー pin: テスト fixture に `<div id="statusTop">` を追加し、`handleLmStudioPreset()` / `handleOllamaPreset()` 呼び出し後に #status と #statusTop の両方が `status-message success` になることを pin。orphan `.status-success` が付かないことの検出テストを含む。旧テストの self-defined handler による fake green を排除
- 回帰証明（production handler が両 run で対象）: pre-fix 2 failed / 14 passed（LM Studio + Ollama の `expected 'status-success' to be 'status-message success'`）→ post-fix 16/16 green。プリセットファイル `--repeats=5` green
- 残骸確認: dashboard src に `.status-success` の書き込み残存なし（popup styles.css:1745 は popup 側の独自契約のため保持）。rank-17 の reload wiring は無変更
- ゲート: `npx tsc --noEmit` 0 エラー / focused vitest（dashboard-lmstudio-preset + generalSettingsPanel スイート 6 ファイル / 32 tests）green / NN20 3 ファイル eslint 0 問題
- 逸脱 1: `npm run validate` を実行不可 — 本統合時点で同一ツリーに NN34（logger モックファクトリ）の未完施工が 169 ファイル分残置され、その `vi.mock` 引数の `););` 構文破壊により `npm run lint` が 167 件の parse error（すべて NN34 ファイル、NN20 対象ファイルは 0 件）を報告する。フルテストスイートも同原因で別途落ちるため、ゲートは tsc + focused vitest + 対象ファイル eslint で代替
- 逸脱 2: コードレビュー未実施（DoD に理由付きで残置）

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する（未実施 — NN34 未完施工の構文破壊 169 ファイルが同一ツリーに残置中のためフルゲート不可。実装記録の逸脱 1 参照）
- [ ] コードレビュー完了（未実施）
