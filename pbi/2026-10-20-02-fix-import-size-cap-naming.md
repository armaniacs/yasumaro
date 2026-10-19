# PBI: settingsExportImport.ts の isOverImportSizeCap を副作用が名前から分かる形にする

## ユーザーストーリー

拡張機能の開発者として、インポートサイズ上限チェックの関数が「チェックとログの両方を行うこと」を名前から読み取れるようにしてほしい、なぜなら `isOverImportSizeCap` は述語名ながら `logError` を副作用として持ち、呼び出し側 `if (await isOverImportSizeCap(jsonData)) return null;` を読む開発者が「false を返すときはログが出ない」ことを見落とし、将来の呼び出し追加で「チェックだけ欲しかったのにログが二重に出る」または逆に「ログが出る前提での再利用が外れる」から。

## 優先度

- 順位: 02 / 6
- RICE: 80（Reach=20 / Impact=0.5 / Confidence=80% / Effort=0.1）
- 根拠: 工数 0.1 の名前修正だが、import 失敗時のログ契約を名前で誠実にする。依存なし
- 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟢なし

## 背景（出典）

2026-10-20 の code-review Suggestion 3。同パスの簡素化で `src/utils/settingsExportImport.ts:213` に `isOverImportSizeCap` が切り出された（importSettings `:398` と importEncryptedSettings `:754` の重複チェック+ログの統合）。関数は `TextEncoder` でサイズを測り、`DEFAULT_IMPORT_SIZE_CAP_BYTES` 超過時に `logError('Import rejected: file exceeds size cap', ...)` を送ってから `true` を返す。この「check + log の結合」は簡素化前から存在したが、切り出しで**述語名の関数に隠れた**。

### VULN-034 との関係

このサイズ上限は、偽造巨大ファイルが PBKDF2 に到達しないための防御（VULN-034）の入口である。チェック自体の挙動変更は本 PBI の範囲外であり、名前と構造の誠実化のみを行う。

## BDD受け入れシナリオ

```gherkin
Scenario: 上限超過のインポートは拒否され、拒否ログが 1 回だけ出る
  Given DEFAULT_IMPORT_SIZE_CAP_BYTES を超える JSON 文字列がある
  When importSettings を呼ぶ
  Then null が返る
  And 'Import rejected: file exceeds size cap' の logError が正確に 1 回出る

Scenario: 上限以下のインポートでは拒否ログが出ない
  Given DEFAULT_IMPORT_SIZE_CAP_BYTES 以下の JSON 文字列がある
  When importSettings を呼ぶ
  Then インポートが続行する
  And サイズ拒否の logError は出ない
```

（現行実装でも GREEN。本 PBI は名前と構造の誠実化であり、挙動は不変。）

## 受け入れ基準

- [ ] `src/utils/settingsExportImport.ts:213` の関数が、副作用を持つことが名前から分かる（動詞名）か、または副作用を分離して述語が純粋になっている
- [ ] 2 呼び出し箇所（`:398` / `:754`）の契約（拒否時に null、ログ 1 回）が変わっていない
- [ ] 既存テスト `src/utils/__tests__/settingsExportImport.test.ts` が無修正で通る（挙動不変の対照）
- [ ] `npm run validate` が緑

## テスト戦略

### 単体

既存 settingsExportImport テスト（79 件）が契約を固定。リネーム・構造変更で落ちないことを確認し、落ちる場合はテストが内部名に依存している証拠なので fixture 側を見直す。

### 統合 / E2E

なし（単一ファイル内のリネーム/分離）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---:|---|
| `src/utils/settingsExportImport.ts` | 213-223 | `isOverImportSizeCap`（check + logError の結合） |
| `src/utils/settingsExportImport.ts` | 398, 754 | 2 呼び出し箇所（importSettings / importEncryptedSettings） |
| `src/utils/__tests__/settingsExportImport.test.ts` | - | 既存契約（79 件） |

### 最小変更の選択肢

**選択肢 1（推奨）: 副作用を分離して述語を純粋に**

`isOverImportSizeCap(jsonData): boolean`（同期・純粋、ログなし）に戻し、ログを `logImportSizeCapExceeded()` ヘルパーに分離。呼び出し側は `if (isOverImportSizeCap(jsonData)) { await logImportSizeCapExceeded(); return null; }`。

- Pros: 述語が名前どおり純粋になり、ログ契約が呼び出し側で明示になる。
- Cons: 呼び出し側が 3 行になる（2 箇所のみなので許容）。

**選択肢 2: 動詞名へのリネームのみ**

`checkImportSizeCapAndLog` のような名前に変え、doc comment に「false のときログが出ない」を明記。

- Pros: 最小 diff（1 箇所）。
- Cons: 名前が長くなる。副作用が隠れたまま。

**選択肢 3: 現状維持 + doc comment のみ**

- Pros: diff ゼロ。
- Cons: 名前から読み取れない状態が続く。

### ロールバック手順

- 変更は settingsExportImport.ts 内のみ。1 コミット。`git revert` で戻せる。実行時挙動は不変。

## 見積もり

0.1pt 🟢

## Definition of Done

- [ ] `npm run validate` が緑
- [ ] 既存テスト無修正で通る
- [ ] コードレビュー完了

## 関連

- pbi/00-INDEX.md
- pbi/2026-10-20-00-backlog-review-findings.md
- 出典: 2026-10-20 code-review Suggestion 3（ブランチ 1020a の簡素化パス差分レビュー）
