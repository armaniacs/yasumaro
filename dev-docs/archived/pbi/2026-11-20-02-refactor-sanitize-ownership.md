# PBI: 符号化所有の固定と順序回帰試験

- 状態: 未着手
- 見積もり: M

## ユーザーストーリー

- 役割: maintainer
- 要求: 用途ごとに符号化の所有を一か所に固定したい。表示は escapeHtml だけ、保存メモは sanitizeForObsidian だけ、promptSanitizer の直接置換は共有経路に寄せたい。
- 理由: XSS 対応や Markdown 分割対応の修正が現状は三か所に分散し、一か所の修正が他に届かない。順序依存の二重符号化と検査回避の恐れをなくしたい。

背景は holistic review theme 2 である。表示 escape と Obsidian 向け符号化と prompt 除去が、それぞれ別の場所で `<` や `>` などを別文字集合で置換し、適用順序に依存している。

## ビジネス価値

- escape 修正箇所が一か所になり、変更漏れが減る。
- 適用順序を回帰試験で固定し、将来の順序変更を検出できる。
- 測定方法: 順序回帰試験の追加と合格、既存 XSS 関連試験の結果が変更前と同一であること。

## BDD受け入れシナリオ

```gherkin
Feature: 符号化所有の固定
  Scenario: markup 入り prompt は従来と同じ出力になる
    Given markup を含む prompt 入力がある
    When 整理後の pipeline で sanitizer を適用する
    Then 出力は変更前と byte 同一であり、表示用は escapeHtml 経由、保存用は sanitizeForObsidian 経由になる

  Scenario: 既に符号化済みの入力は二重符号化しない
    Given "&lt;" を含む既符号化入力がある
    When pipeline を適用する
    Then "&amp;lt;" のような二重符号化にならず、変更前の出力と同一になる

  Scenario: 空入力は空のまま返す
    Given 空文字または null の入力がある
    When sanitizer を呼ぶ
    Then early return により空のまま返り、例外を出さない
```

## 受け入れ基準

- [x] `src/utils/promptSanitizer.ts` の直接置換 `.replace(/</g,'&lt;').replace(/>/g,'&gt;')` が削除されていること
- [x] prompt 経路が共有 seam (escapeHtml / sanitizeForObsidian のいずれか用途に応じた方) を呼ぶこと
- [x] 用途別の所有が守られていること: 表示は escapeHtml のみ、保存メモは sanitizeForObsidian のみ
- [x] 適用順序が一か所に固定され、コードで読めること
- [x] 順序回帰試験が追加され green であること
- [x] XSS 関連 suite (popup-xss 等、jsdom 環境) が green であり、結果が変更前と同一であること
- [x] null / 空文字の early return が保持されていること

## テスト戦略

- 変更前に parity 試験で現行出力を固定する。二重符号化 case (`&lt;` 入力、`&` 入り入力、`"` 入り入力) を golden fixture に含める。
- 順序の unit 試験を追加する。順序を入れ替えた場合に失敗することで、順序固定を証明する。
- 既存 sanitizer suite (htmlEscape、markdownSanitizer、promptSanitizer、popup-xss 等) を回す。jsdom 環境の指定を変えない。
- ふるまい変更は禁止のため、parity fixture との byte 比較を必須とする。差分が出たら PBI 失格とする。

## 実装アプローチ

1. parity-pin: 現行出力を golden fixture として試験に固定する (ふるまい変更なし)。
2. refactor: 所有を用途別に寄せる。promptSanitizer の直接置換を除去し、共有 seam 経由に変える。順序を一か所に書く。
3. keep green: 順序回帰試験と既存 XSS 関連試験を green に保つ。差分が出たら実装を戻して原因を切り分ける。

## 技術的考慮事項

- 依存: なし (外部依存の追加なし)。
- rollback: 単一 commit への git revert で戻せる単位にすること。
- 注意: sanitizer のふるまいは変えないこと。pure move のみ。出力差分は本 PBI の失敗とみなす。

## 実装者向け注記

### 現状コードの確認

```bash
rg -n "escapeHtml|sanitizeForObsidian" src/utils/htmlEscape.ts src/utils/markdownSanitizer.ts src/utils/promptSanitizer.ts
rg -n "replace\(/</g" src/utils/promptSanitizer.ts
rg -n "jsdom" vitest.config.ts testDir/vitest.config.ts package.json
```

- `src/utils/htmlEscape.ts:29` が `& < > " ' /` の canonical な表示 escape であり、所有宣言は同ファイル `:1` にある。
- `src/utils/markdownSanitizer.ts:107` が Obsidian 向け `& < >` 符号化であり、宣言は同ファイル `:81` にある。
- `src/utils/promptSanitizer.ts:422` が直接置換 `.replace(/</g,'&lt;').replace(/>/g,'&gt;')` であり、`&` と `"` を扱わない。
- 未実装であることを 2026-11-20 に確認済み。

### 実装手順

1. 上記 grep で三か所の現状を確認する。
2. parity 試験を先に書く。正常系、既符号化入力、空/null、二重符号化 case を含める。
3. parity 試験が green であることを確認する (現行出力の固定)。
4. promptSanitizer の直接置換を除去し、用途に応じた共有 seam 呼びに置き換える。null / 空の early return は残す。
5. 適用順序を一か所に固定する。順序回帰試験を追加する。
6. `npm run validate` と XSS 関連 suite を実行し、変更前と結果が同一であることを確認する。

### 落とし穴

- 順序依存: 変更前後で pipeline 順序を確認し、golden fixture と byte 同一の出力を保つこと。順序を変えただけの差分も失敗とみなす。
- 三か所の `&` 扱いの差 (promptSanitizer が `&` と `"` を扱わない点) をここで「修正」しないこと。対象外であり、pure move のみとする。修正は別 PBI とする。
- jsdom 環境の XSS 試験 (popup-xss 等) は jsdom のままにすること。環境変更はしないこと。

## Definition of Done

- 全 BDD シナリオが自動試験として合格すること。
- coverage 閾値 80/80 を変更しないこと。
- PR の approve が必要であること。
- green 後の refactor 完了であること (red のまま終えない)。
- rollback 手順 (単一 commit への git revert) が記録されていること。
- ふるまい注記のある docs があれば更新すること。
