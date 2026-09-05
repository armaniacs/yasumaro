# PBI: ダウンロード filename にパストラバーサル・上書きガードを追加

## ユーザーストーリー
拡張機能の利用者として、Markdown 書き出し先の設定値がファイル名に混入しても安全であってほしい、なぜなら `../` や絶対パスが素通しされると意図しない場所への書き込みや既存ファイルの上書きが起きうるから

## 優先度
- 順位: 22 / 26
- RICEスコア: 360（Reach=100 / Impact=2 / Confidence=0.9 / Effort=0.5日）
- 根拠: 悪用には書き出し先設定への `../` 入力が必要で Reach は小さいが、書き込み先逸脱の影響は大きく、修正は filename 組み立て 4 箇所への sanitize 適用で Effort は小さい。Confidence は高（全呼び出しの素通しを確認済み）。

## BDD受け入れシナリオ
```gherkin
Scenario: 書き出し先にトラバーサルが含まれても逸脱しない
  Given 書き出し先設定に `../evil` が入力されている状態
  When  日次 Markdown フラッシュを実行する
  Then  ダウンロード filename に `..` が含まれず、代替フォルダにフォールバックする

Scenario: 日付由来のファイル名部分は正規形式のまま保たれる
  Given 正常な書き出し先 `Yasumaro` が設定されている状態
  When  日次フラッシュを実行する
  Then  filename が `Yasumaro/YYYY-MM-DD.md` 形式でダウンロードされる

Scenario: 既存ファイルへの上書きは明示ポリシーに従う
  Given 同名ファイルが既に存在する状態
  When  フラッシュを実行する
  Then  conflictAction が意図通り（日次上書き or ユニーク化）であり、無警告の黙示上書きにならない
```

## 受け入れ基準
- [x] 4 箇所の `chrome.downloads.download` 呼び出しに渡す `filename` が sanitize 経由になり、`../`・絶対パス・制御文字が除去/拒否される
- [x] sanitize 失敗時は `DEFAULT_EXPORT_PATH`（`Yasumaro`）にフォールバックし、ダウンロード自体は継続する
- [x] `conflictAction` の方針が 4 箇所で統一意図として文書化される（現状 `overwrite` の是非を含む）
- [x] 既存の export・retention 関連テストが green のままであること

## テスト戦略
- 単体: `exportFilenameFor` / フラッシュ前 filename 組み立てに `../`・`/absolute`・制御文字入り exportPath を与え、逸脱しないこととフォールバックを表明する
- 単体: 正常系 `Yasumaro/2026-08-09.md` 形式が保たれること（`markdownExport.test.ts:161` の既存ケースを拡張）
- 結合: `flushBufferedExports` をモック download で駆動し、悪性 exportPath でも安全な filename が渡ることを検証する

## 実装アプローチ
`sanitizePathSegment`（`src/utils/pathSanitizer.ts:61`）をダウンロード filename 組み立ての単一 choke point（`exportFilenameFor` と `flushBufferedExports`／`downloadMarkdown`／接続テストの filename 行）に適用する。日付部分は内部生成の `YYYY-MM-DD` 固定で検証不要のため、sanitize 対象はユーザー設定の `exportPath` のみとする。失敗時は `DEFAULT_EXPORT_PATH` にフォールバックする。

## 見積もり
1ポイント（0.5日相当：4 箇所への sanitize 適用と単体テストが中心）

## 実装者向け注記
- 素通し 4 箇所（いずれも `conflictAction: 'overwrite'`・exportPath 未検証）: `src/background/localMarkdownExportCore.ts:56-61`（`filename: \`${exportPath}/${date}.md\``）、`src/dashboard/generalSettings/connectionTests.ts:353-358`（`filename: \`${exportPath}/test-${date}.md\``）、`src/dashboard/markdownExport.ts:110-112` の `exportFilenameFor`（経由で `chromeDownloadPort:253-258`）、`src/background/reviewSummaryGenerator.ts:168-173`（`filename: \`${exportPath}/${filename}\``、filename 自体は `week-NN`/`month-NN` の内部生成で安全）
- exportPath はユーザー設定の自由文字列: `src/utils/storage/types.ts:467` で `string` 型、`src/utils/storage/defaults.ts:166` で既定 `'Yasumaro'`。設定 UI 側の検証は未確認のため本 PBI では書き込み境界での防御に寄せる
- `sanitizePathSegment` は実績ありだが prod 呼び出しゼロ: `rg -n "sanitizePathSegment|sanitizePathForUrl" src tests --glob '*.ts'` で参照は `pathSanitizer.ts` 本体と `src/utils/__tests__/pathSanitizer.test.ts` のみ。`..`・`\`・スキーム注入を throw するため、呼び出し側で try/catch→フォールバックが必要
- retention との混同注意: `src/background/localMarkdownExportRetention.ts`（上限 200 件・30 日）は download 記録側の cap であり filename sanitize は未対応。範囲外としないこと
- 調査用 rg: `rg -n "downloads.download" src --glob '*.ts' | grep -v __tests__`、`rg -n "LOCAL_MARKDOWN_EXPORT_PATH" src --glob '*.ts' | grep -v __tests__`

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（書き出し先設定の入力制約があれば）

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `7676a3e8`、SDD サブエージェント実装）。4 つの `chrome.downloads.download` 呼び出しの filename に `sanitizePathSegment` を適用（トラバーサル・制御文字・先頭ドットを排除、空になった場合のフォールバック付き）。ドット含みの正当名もフォールバックに倒れる厳格仕様は PBI 通り。
