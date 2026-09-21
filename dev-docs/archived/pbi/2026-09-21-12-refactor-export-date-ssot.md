# PBI: エクスポート経路の日付分解とタグ解析を SSOT に統一する

## ユーザーストーリー
JST 地域の利用者として、日次エクスポートと単発 Markdown エクスポートで同じ閲覧履歴が同じ日付に分類されてほしい、なぜなら深夜帯の記録が経路によって別の日次ファイルに分かれると履歴の追跡と比較が破綻するから

## 優先度
- 順位: 11 / 11
- RICEスコア: 4.8（Reach=3 / Impact=2 / Confidence=80% / Effort=1.0週）
- 種別: refactor
- 根拠: 発生条件は深夜境界付近の記録に限られ Reach は 3 に留まるが、日付分類の不整合はデータ信頼性の毀損であり、放置するとサポート調査コストが増える。Effort が小さく SSOT への寄せで再発を構造的に防げる

## ビジネス価値
日付バケット分類の信頼性が回復し、深夜帯の記録が全エクスポート経路で同一の日次ファイルに属する。タグ解析の二重実装が解消され、将来のタグ仕様変更の修正点が1箇所になる。テストエクスポートのファイル名日付も本番経路と一致し、日付ずれの問い合わせが減る

## BDD受け入れシナリオ

```gherkin
Scenario: 深夜境界の記録が両エクスポート経路で同じ日付になる
  Given JST 環境で 2026-09-21 00:30 JST の created_at を持つ履歴行
  When 日次エクスポートと単発 Markdown エクスポートを実行する
  Then 両方の出力が同一の YYYY-MM-DD 日付に分類される

Scenario: タグ文字列の解析結果が SSOT と一致する
  Given tags カラムに JSON 配列文字列と不正 JSON が混在する履歴行
  When 単発 Markdown エクスポートを実行する
  Then タグの解析結果が buildTemplateEntryData 系 SSOT と同一になる

Scenario: テストエクスポートのファイル名日付がローカル日付になる
  Given JST 環境で UTC 日付とローカル日付が異なる時刻(例: 2026-09-21 08:00 JST = 2026-09-20 23:00 UTC)
  When ローカル Markdown 書き出しテストを実行する
  Then テストファイル名の日付がローカル日付(getLocalDateString と同一)になる
```

## 受け入れ基準
- [x] exportLogsService の exportMarkdown の日付分解が getLocalDateString に委譲される
- [x] exportMarkdown のタグ解析が可能な範囲で buildTemplateEntryData 系 SSOT に寄せられる
- [x] connectionTests のテストエクスポートのファイル名日付が同一 helper に統一される
- [x] YAML frontmatter の出力形状は現行維持される(形状統合はスコープ外)
- [x] golden テストで現行出力を pin してから差し替えが行われる
- [x] UTC から local への意図的変更が変更履歴またはコードコメントに記録される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善。出力形状は golden で固定)

### 統合テスト
- 深夜境界の created_at 行を両エクスポート経路に通し、日付分類の一致を検証する
- tags カラムの正常系・不正 JSON・null の3系で SSOT との解析一致を検証する
- テストエクスポートのファイル名日付が getLocalDateString と一致することを検証する

### 単体テスト
- getLocalDateString 委譲後の exportMarkdown の日付境界(JST の 00:00 前後)
- タグ解析のフォールバック(不正 JSON → 空配列)が SSOT と同一であること

## 実装アプローチ
- **Outside-In**: まず現行出力の golden テストを書き(Red 不要の pin)、green を確認してから差し替え
- exportMarkdown の日付分解を getLocalDateString 呼び出しに置換し、タグ解析を buildTemplateEntryData 系に寄せる
- connectionTests の `now.toISOString().split('T')[0]` を同一 helper に置換する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 他 PBI とは独立。日次エクスポート側(markdownExport)の振る舞い変更はなし
- 遵守すべき設計: 日付分解の SSOT は getLocalDateString、タグ付き Markdown 変換の SSOT は buildTemplateEntryData 系
- 非機能要件: YAML frontmatter の出力形状は byte 等価を維持する。形状統合は別 PBI とする
- UTC から local への意図的変更: テストエクスポートのファイル名のみ日付が前後する可能性があり、リリースノートまたはコードコメントに記録する

## 実装者向け注記

### 現状の証拠
- 日付分解の二重実装: `src/dashboard/exportLogsService.ts:60-65` が `new Date(entry.created_at).toLocaleDateString('en-CA', {...timeZone})` で分解する一方、`src/dashboard/markdownExport.ts:49-55` の getLocalDateString は `getFullYear/getMonth/getDate` の手動分解であり、`markdownExport.ts:88,176` で使用される
- タグ解析の二重実装: `src/dashboard/exportLogsService.ts:66-69` が inline try/catch の JSON.parse でタグを解析する一方、`src/dashboard/markdownExport.ts:63-80` の toMarkdownTemplateEntryData は buildTemplateEntryData(tagChain 'obsidian') 経由の SSOT である
- 第3変種: `src/dashboard/generalSettings/connectionTests.ts:353` が `now.toISOString().split('T')[0]`(UTC)でテストエクスポートのファイル名日付を生成する
- 失敗条件: JST ユーザーの深夜境界の行が2つのエクスポート経路で別の日次ファイルに分類される。テストエクスポートのファイル名だけ UTC で日付ずれの可能性がある

## Definition of Done
- 全BDDシナリオが実装されパスする
- コードレビューが完了する
- 統合検証が green である
