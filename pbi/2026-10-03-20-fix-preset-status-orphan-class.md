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

- [ ] `src/dashboard/panels/staticForm/generalSettingsPanel.ts:338,350` の直接 `className = 'status-success'` 書き込みが、settingsUiHelper の派生契約（`STATUS_BASE_CLASS` + type、現 :14,72）または `showStatus` への統一に置き換わる
- [ ] dashboard の #status に契約外クラスが付かない（`entrypoints/options/dashboard.css:898-954` の契約と整合）
- [ ] statusView/status の二重経路（現 :339,351 の syncStatusToTop 併用）が解消される
- [ ] `src/dashboard/__tests__/dashboard-lmstudio-preset.test.ts:205-217` が production handler を対象に書き直される
- [ ] 本 PBI は rank-02（reload seam PBI）の後に serially 実施される（同一ファイルチェーン）
- [ ] 単体テストが追加・更新される（実時間待ちなし）
- [ ] 既存 dashboard 関連テストが green

## テスト戦略

- 単体: production handler 経由で #status の className が `status-message success`（または showStatus 契約）に一致することを pin。orphan クラス検出テストを含める
- 実時間待ち・固定 sleep は使わない。既存テスト green 維持 + `npm run validate` 通過

## 見積もり

1.0 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
