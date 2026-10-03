# PBI: プリセットボタンのデータ駆動化と優先スロット ID の SSOT 化

## ユーザーストーリー

保守者として、プロバイダ プリセットボタンをデータテーブルから生成し、優先スロットの要素 ID リストを単一の SSOT に統一したい。lmStudio / ollama ボタンがほぼクローンで、ID リストが 4 箇所に手書きされ、index+1 と data-priority が暗黙結合しているため、プロバイダ追加やスロット変更の影響範囲が読み取りにくいからだ。

## 優先度

- 種別: refactor
- 順位: 08 / 20
- RICEスコア: 9.0（Reach=5 / Impact=1 / Confidence=0.9 / Effort=0.5 SP）
- 根拠: ボタン追加がテーブル 1 行、スロット ID 変更がリスト 1 箇所に縮む。Confidence 0.9 は同一ファイルチェーンの先行 PBI との統合順序調整が前提のため。
- 依存: rank-02 reload PBI、rank-05 preset-status PBI の後に実施する（generalSettingsPanel.ts 同一ファイルチェーン）。

## 背景

- `src/dashboard/panels/staticForm/generalSettingsPanel.ts:331-353` — lmStudio / ollama のプリセットボタンがほぼクローン。差分は btnId / providerKey / messageKey の 3 点のみ。
- 同一ファイル内で優先スロットの ID リストが 4 箇所に手書き: `:94`、`:163-165`、`:178`、`:189-191`。`['aiProviderPriority2','aiProviderPriority3']` と 3 要素版が混在。
- `:181` — `data-priority="${index+1}"` がリストの並び順に暗黙結合。

## BDD受け入れシナリオ

```gherkin
Scenario: プリセットボタンはデータテーブルから生成される
  Given プリセットボタンの定義テーブルに btnId / providerKey / messageKey が 1 行で定義されている
  When プロバイダを 1 行追加する
  Then 対応するプリセットボタンが既存ボタンと同一の構造で生成される

Scenario: 優先スロットの ID リストは 1 箇所でのみ管理される
  Given 優先スロットの ID リストが単一の SSOT 定数に定義されている
  When スロット構成を変更する
  Then 4 箇所の手書きリストを個別に修正する必要がない
  And data-priority は SSOT の順序から導出される

Scenario: 既存の優先度設定動作は変わらない
  Given 変更前に優先度スロットの設定保存・復元が機能している
  When リファクタリングを適用する
  Then スロットの ID、data-priority の値、設定保存・復元・反映の動作が変更前と同一である
```

## 受け入れ基準

- [ ] プリセットボタンがデータ駆動テーブルから生成され、lmStudio / ollama のクローン記述が解消されている。
- [ ] 優先スロットの ID リストが単一の SSOT 定数に統一され、4 箇所の手書きが解消されている。
- [ ] data-priority が SSOT の順序から導出され、index+1 の暗黙結合が解消されている。
- [ ] 生成される DOM（ID、data-priority、ラベル）は変更前と同一である。
- [ ] 優先度設定の保存・復元・反映動作に回帰がない。
- [ ] rank-02 reload PBI、rank-05 preset-status PBI との統合順序が確定している。
- [ ] `npm run validate` が成功している。

## テスト戦略（t_wadaスタイル）

### 単体テスト

- 既存の generalSettingsPanel 関連テストで、生成 DOM の ID / data-priority / ラベルをパリティ検証する。
- テーブル 1 行追加時に対応ボタンが生成されることを検証する。

### 統合テスト

- 設定保存・復元の導線で優先度スロットが正しく機能することを確認する。

## 見積もり

**0.5 SP**

テーブル化、SSOT 定数の導入、DOM パリティ確認、依存 PBI との統合順序調整を含む。

## Definition of Done

- [ ] プリセットボタンがデータ駆動化されている。
- [ ] 優先スロット ID リストの SSOT が確立している。
- [ ] data-priority の暗黙結合が解消されている。
- [ ] DOM と優先度動作に回帰がない。
- [ ] 依存 PBI との統合順序が確定している。
- [ ] `npm run validate` が成功している。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
