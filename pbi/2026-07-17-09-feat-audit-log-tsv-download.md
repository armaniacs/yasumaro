# PBI: 監査ログの TSV ダウンロード機能

## ユーザーストーリー

開発者として、監査ログ（どのページがどの AI プロバイダーへ送信されたかの記録）を TSV 形式でダウンロードできるようにしたい。なぜなら現在のテーブル UI（検索・プロバイダーフィルタ・ソート）は過剰であり、エクスポートしてスプレッドシートで分析する方が効率的だから。

## ビジネス価値

- 監査ログを外部ツール（Excel / Google Sheets / pandas）で分析可能
- ダッシュボードのコード量削減（テーブル UI の保守コスト削減）

## 方針

現在の監査ログパネル（`panels/asyncData/auditLogPanel.ts`）は削除し、「TSV でダウンロード」ボタンのみに置き換える。検索・フィルタ・テーブル表示は不要。

## BDD シナリオ

```gherkin
Feature: 監査ログの TSV ダウンロード

  Scenario: TSV ダウンロードボタンで全件ダウンロード
    Given ユーザーがダッシュボードの監査ログパネルを開いている
    When  「TSV でダウンロード」ボタンをクリックする
    Then  監査ログの全レコードが TSV ファイルとしてダウンロードされる

  Scenario: 監査ログが 0 件の場合でもボタンは表示される
    Given 監監査ログテーブルが空である
    When  監査ログパネルを開く
    Then  「TSV でダウンロード」ボタンが表示される

  Scenario: TSV ファイルの内容が正しい
    Given 3 件の監査ログがある
    When  TSV をダウンロードする
    Then  ヘッダー行に "id", "provider", "url", "created_at" が含まれ
    And   3 件のデータ行が含まれ
    And   created_at は ISO 8601 形式である
```

## TSV 出力形式

```
id	provider	url	created_at
1	openai2	https://example.com/page1	2026-07-17T12:34:56.000Z
2	openai2	https://example.com/page2	2026-07-17T13:00:00.000Z
```

- 区切り文字: タブ (`\t`)
- 改行: LF (`\n`)
- ヘッダー: `id`, `provider`, `url`, `created_at`
- `created_at`: Unix タイムスタンプ → ISO 8601 変換
- ファイル名: `yasumaro-audit-log-YYYY-MM-DD.tsv`

## 受け入れ基準
- [ ] 「TSV でダウンロード」ボタンが監査ログパネルに表示される
- [ ] ボタンクリックで `queryAuditLogs({ limit: 10000 })` し、全件を TSV 形式でダウンロード
- [ ] ファイル名が `yasumaro-audit-log-YYYY-MM-DD.tsv`
- [ ] ヘッダー行 + データ行の形式が正しい
- [ ] 既存の全テストがパスする
- [ ] 型チェックがパスする

## 実装アプローチ

1. `auditLogPanel.ts` の `render()` を簡素化: テーブル・検索・フィルタを削除し、説明文 + ダウンロードボタンのみ
2. ダウンロード関数を新設:
   - `queryAuditLogs({ limit: 10000 })` で全件取得
   - `toTsvString(rows)` で TSV 文字列に変換
   - `Blob` + `URL.createObjectURL` + `chrome.downloads.download` で保存
3. パネル抽象化版 (`panels/asyncData/auditLogPanel.ts`) も同様に簡素化

## 見積もり
1 pt（UI 簡素化 + TSV 変換 + ダウンロード）

## 技術的考慮事項
- `chrome.downloads.download` はダッシュボードコンテキストから呼び出し不可（SW 経由が必要）
- 代替案: `Blob` + `<a download>` の DOM クリックでダウンロード（ダッシュボードから直接可能）
- ダッシュボードが `options.html` であるため、`URL.createObjectURL` + `<a>` パターンが最もシンプル
