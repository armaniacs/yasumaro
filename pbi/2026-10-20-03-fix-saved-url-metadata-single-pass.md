# PBI: savedUrlRepository.ts の saveSavedUrlEntryMetadata の二重走査を 1 回にまとめる

## ユーザーストーリー

拡張機能の開発者として、保存 URL エントリのメタデータ更新が配列を 1 回だけ走査してほしい、なぜなら現行は `entries.some()` で存在確認した後、`replaceEntry` が `findIndex` で**同じ配列をもう一度**走査するため、エントリ数が増えた場合に無駄な 2 回目の走査が発生し、「1 回の発見と置換」という意図がコードから読み取りにくくなるから。

## 優先度

- 順位: 03 / 6
- RICE: 60（Reach=60 / Impact=0.25 / Confidence=80% / Effort=0.2）
- 根拠: 影響は微小（配列は小さい）だが、2026-10-20 の簡素化で導入された二重走査であり、安価に戻せる。依存なし
- 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟢なし

## 背景（出典）

2026-10-20 の code-review Suggestion 2。同パスの簡素化で `saveSavedUrlEntryMetadata`（`src/utils/storage/savedUrlRepository.ts:388`）が `entries.some()` による存在確認と `replaceEntry`（`:143` 定義、内部で `findIndex`）による置換の 2 段構成になった。旧実装は `findIndex` 1 回で idx を出し、その idx で分岐・置換していた。`replaceEntry` は `updateSavedUrlEntry` からも使われるため、消すのではなく**メタデータ側だけ 1 回の発見に戻す**のが本 PBI の範囲。

## BDD受け入れシナリオ

```gherkin
Scenario: 既存 URL のメタデータ更新は従来どおりの結果になる
  Given savedUrlsWithTimestamps に url: 'https://a.test/' のエントリがある
  When saveSavedUrlEntryMetadata をその URL で呼ぶ
  Then 該当エントリのメタデータだけが更新される
  And 配列の順序・他エントリが変わらない

Scenario: 存在しない URL は createIfMissing に従う
  Given savedUrlsWithTimestamps に url: 'https://missing.test/' のエントリがない
  When saveSavedUrlEntryMetadata を createIfMissing: true で呼ぶ
  Then 新エントリが末尾に追加される
  When createIfMissing: false で呼ぶ
  Then 配列が変わらない

Scenario: refreshTimestamp の意味が変わらない
  Given 既存エントリがある
  When refreshTimestamp: true / false の 2 通りで呼ぶ
  Then true のときだけ timestamp が更新される
```

（すべて現行 GREEN。本 PBI は走査回数と可読性の改善で、挙動は不変。）

## 受け入れ基準

- [ ] `saveSavedUrlEntryMetadata` が配列を 1 回の `findIndex`（または等価な単一走査）で分岐・置換する
- [ ] `replaceEntry` と `updateSavedUrlEntry` の既存契約が変わっていない（`updateSavedUrlEntry` は現行のまま）
- [ ] 既存テスト（savedUrl 系 113 件）が無修正で通る
- [ ] `npm run validate` が緑

## テスト戦略

### 単体

savedUrl 系既存テスト（113 件）が挙動を固定。呼び出し回数の assert は不要（配列は小さく、効果は可読性が主体）。

### 統合 / E2E

不要。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/utils/storage/savedUrlRepository.ts` | 388-410 | `saveSavedUrlEntryMetadata`（some + replaceEntry の 2 段） |
| `src/utils/storage/savedUrlRepository.ts` | 143-157 | `replaceEntry`（module-private、`updateSavedUrlEntry` と共有） |
| `src/utils/storage/savedUrlRepository.ts` | 370-384 | `updateSavedUrlEntry`（現行のまま維持） |

### 最小変更の選択肢

**選択肢 1（推奨）: メタデータ側で idx を 1 回計算**

`const idx = entries.findIndex(...)` を 1 回出し、`idx < 0` で create 分岐、`idx >= 0` でコピー+置換。旧実装と同形に戻す。

- Pros: 走査 1 回。旧実装と同形で diff が読みやすい。
- Cons: メタデータ側の置換ロジックが replaceEntry から離れる（重複は最小）。

**選択肢 2: replaceEntry を { entries, found } を返すバリアントに拡張**

- Pros: 共有ヘルパーを維持。
- Cons: 戻り値契約が変わり、updateSavedUrlEntry 側も触ることになる。

### ロールバック手順

- 変更は savedUrlRepository.ts 内のみ。1 コミット。`git revert` で戻せる。実行時挙動は不変。

## 見積もり

0.3pt 🟢

## Definition of Done

- [ ] `npm run validate` が緑
- [ ] 既存テスト無修正で通る
- [ ] コードレビュー完了

## 関連

- pbi/00-INDEX.md
- pbi/2026-10-20-00-backlog-review-findings.md
- 出典: 2026-10-20 code-review Suggestion 2（ブランチ 1020a の簡素化パス差分レビュー）
