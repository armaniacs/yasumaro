# PBI: Settings IA の再編（29 パネルの分類または検索）

## ユーザーストーリー

設定を探すユーザーとして、目的の設定に迷わず辿り着きたい。なぜなら、29 パネルの平らな並びでは発見可能性が落ちているから。

## 優先度

- 順位: 8 / 9（全候補）
- RICEスコア: 1.3（Reach=4 / Impact=1 / Confidence=50% / Effort=1.5人週）
- 根拠: オプション UI が 29 パネルまで増え（CHANGELOG 6.9.63 の「第 29 パネル」記載）、パネル検索・分類再編なしで追加し続けると既存ユーザーが目的の設定に届かなくなる（ユーザージャーニー J4）。工数が 1.5 人週と大きく、Confidence が 50% であるため 9 候補中 8 位。将来分割の注記: 検索と分類再編を 1 つの PBI に詰めない。両方が必要になった場合は別 PBI に分割する。

## ビジネス価値

- パネルが増え続けても既存ユーザーが目的の設定に迷わず辿り着け、「設定が見つからない」による設定利用の断念を防ぐ
- 測定方法: E2Eテスト（目的のパネルへ迷わず辿り着ける）の緑、目的パネル到達までの操作数（クリック数）の変化、「設定が見つからない」系のユーザーフィードバックの減少

## BDD受け入れシナリオ

```gherkin
Scenario: 分類から目的のパネルに辿り着く（ハッピーパス）
  Given オプション画面に 29 パネルが表示されている
  When ユーザーが分類 UI で目的の設定を含む分類を選ぶ
  Then その分類のパネルのみが表示され、目的のパネルが見える

Scenario: 分類が未割り当てのパネル（境界値）
  Given 分類が割り当てられていないパネルが 1 つ存在する
  When 分類 UI を表示する
  Then そのパネルは「その他」に配置され、ユーザーが辿り着ける

Scenario: en ロケールでの分類名表示（境界値）
  Given オプション画面のロケールが en である
  When 分類 UI を表示する
  Then すべての分類名が _locales/en 経由で英語表示される
```

## 受け入れ基準

- [x] 着手時にオプション画面のパネル実数を実測して記録する（29 かを確認）
  - 実測: `entrypoints/options/index.html` の sidebar 内 `data-panel` 付き nav ボタンは 29 個（`SIDEBAR_PANELS.length === 29` の pin テストとも一致）。6.9.63 時点と同じ 29。
- [x] パネルの分類再編または検索を、1 価値単位の縦スライスとして実装する（両方は実装しない）
  - 分類 UI（select によるパネル分類フィルタ）のみを実装。検索 UI は実装しない（BDD シナリオが分類前提のため分類を採用）。
- [x] 追加・変更したラベルと分類名を data-i18n・_locales/ja/en で同時に更新する
  - `panelCategoryFilterLabel`（data-i18n）と分類名 8 キー（option は data-i18n-opt）を `_locales/ja/messages.json` と `_locales/en/messages.json` の両方に追加。`npm run check-i18n` 通過。
- [x] manifest permissions と storage key 構造を変更しない
  - 分類状態は DOM の hidden 属性のみで保持（storage キー追加なし）。manifest.json は無変更（git diff で確認）。
- [x] パネルの削除・リネームを行う場合、既存ユーザーの保存済み設定への影響が無いことを確認する
  - パネルの削除・リネームは行っていない（`PANEL_CATALOG` の 29 パネルは無変更）。フィルタはボタンの可視性のみを変え、パネル本体・セクション要素はそのまま。
- [x] focusTrap とキーボードナビゲーション（WCAG 2.1 AA）の規約に従う
  - roving tabindex + 矢印キー navigation を維持し、分類フィルタで隠れたタブをスキップする規約を追加（隠れたタブに focus() が失敗して以降のタブが到達不能になる WCAG 2.1.1 の欠陥を構造的に回避）。分類 select は native control で `<label for>` 付き、モーダルではないため focusTrap の対象外。

## テスト戦略

### E2Eテスト

- 目的のパネルへ迷わず辿り着けること。分類 UI の表示とパネルの可視は expect.poll で待つ（固定時間待ちを挟まない）。headed は owner 手動でも可

### 統合テスト

- パネル一覧の生成（分類結果とパネル数・表示順が定義と一致すること）

### 単体テスト

- 分類ロジック（パネルから分類への割り当て、未割り当てパネルのフォールバック）と検索フィルタ、i18n キー解決

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること。パネル実数は着手時に実測する。29 は 6.9.63 時点の CHANGELOG 由来で、着手時点で変わっている可能性）

```bash
grep -rn "panels" src/dashboard/ | head -20
grep -rn "data-i18n" src/dashboard/ | head -10
```

パネル検索・分類 UI は未実装であることをブレスト時点で確認済み。着手時に上記で再確認すること。

### 実装手順

1. E2E: 目的のパネルへ迷わず辿り着ける失敗テストを先に書き、赤を確認する
2. 統合: パネル一覧の生成テストを書き、パネルごとの分類の定義を確定する
3. 単体: 分類（または検索）ロジックのテストを書く（TDD）
4. 実装: 分類 UI（または検索 UI）を実装し、data-i18n・_locales/ja/en を同時に更新する
5. パネル並び替えの pin テスト（順序断定）が既存なら、更新をセットで行う
6. npm run build 後に Chrome でキーボード操作と focusTrap を手動確認し、npm run validate を通す

### 落とし穴

- パネル列挙は実装時に実測する（29 は 6.9.63 時点の CHANGELOG 由来で、着手時点で変わっている可能性）
- 検索を付ける場合、data-i18n のローカライズ済み文字列を対象にするか英語キーを対象にするか決める（ロケールで一致結果が変わる）
- 検索を採用する場合は BDD シナリオと E2E テストを検索用に置き換え、検索だけの縦スライスに絞る
- パネルの並び替えは pin テスト（順序断定）が既存なら更新がセット
- manifest permissions・storage key 構造は破壊変更の高リスク領域のため触れない
- 分類と検索の両方を 1 つの PBI に詰めると将来分割が必要になる（両方は実装しない）

## 見積もり

2pt目安（1.5人週相当）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
  - シナリオ 1（分類から辿り着く）: `panelCategoryFilter.test.ts`（単体）+ `dashboard-category-filter.spec.ts` @extension（E2E、分類選択→タブ表示→クリック→パネル active）
  - シナリオ 2（未割り当てパネルはその他）: `panelCategories.test.ts`（`categoryForPanel` の 'other' フォールバック）+ E2E（other → diagnostics のみ表示）
  - シナリオ 3（en ロケールの分類名）: `panelCategories.test.ts`（両 locale のキー実在）+ E2E（en-US ピンで option テキスト断定）
- [x] コードレビュー完了（セルフレビュー: ONE slice 厳守・i18n 完全性・focusTrap/aria 整合・storage/manifest 無変更。`.superpowers/sdd/2026-10-31-round/pbi-08-report.md`）
- [x] ドキュメント更新済み（本 PBI の AC/DoD と実装注記）
