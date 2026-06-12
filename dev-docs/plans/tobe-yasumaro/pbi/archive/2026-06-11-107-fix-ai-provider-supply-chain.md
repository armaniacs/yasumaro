# PBI: AI プロバイダー最適化 & サプライチェーン健全化

## ユーザーストーリー
**運用者**として、**AI API呼び出しが効率的で、依存関係が健全**であることを望む、なぜなら**不要なトークン消費を避け、ライセンスリスクを排除したい**から

## ビジネス価値
- AI API コストの削減（リトライの冪等性確保）
- ライセンス違反リスクの排除
- 依存関係の推移的脆弱性の検出

## BDD受け入れシナリオ

```gherkin
Scenario: AI API タイムアウト時にリトライが1回に制限される
  Given OpenAIProviderのfetchWithRetry
  When タイムアウトエラーが発生する
  Then リトライは1回のみ実行される
  And 2回目のタイムアウト後はエラーが返される
  And トークン消費が最大2回分に制限される

Scenario: AI API レートリミット時はリトライが抑制される
  Given OpenAIProviderのfetchWithRetry
  When 429 (Rate Limit) エラーが発生する
  Then リトライは実行されない
  And ユーザーにレートリミット通知が表示される

Scenario: wa-sqliteのライセンスが記録されている
  Given package-lock.jsonのwa-sqliteエントリ
  When SBOM生成ツールがライセンスをチェックする
  Then MITライセンスが正しく記録されている
  And third-party-noticesにMITライセンス全文が含まれている

Scenario: htmlparser2のオーバーライドが不要になったら検出される
  Given .npmrcまたはCIスクリプト
  When Node.jsバージョンが25以上にアップデートされる
  Then overrides削除後のnpm testが自動実行される
  And テストがパスすればオーバーライド不要と通知される

Scenario: favicon権限がモバイルChromeで警告を出さない
  Given wxt.config.tsのpermissions
  When モバイルChromeで拡張機能をインストールする
  Then favicon権限がoptional_permissionsに移動されている
  And インストール警告が表示されない

Scenario: AI要約プロンプトが多言語に対応している
  Given ブラウザ言語が韓国語（ko）のユーザー
  When AI要約機能が呼ばれる
  Then 韓国語プロンプトが使用される
  And 英語フォールバックは発生しない
```

## 受け入れ基準
- [x] `fetchWithRetry`のタイムアウト時リトライを1回に制限
- [x] 429 (Rate Limit) 時はリトライしない
- [x] wa-sqliteのライセンスをpackage-lock.jsonに記録
- [x] third-party-noticesにMITライセンス全文を追加（THIRD_PARTY_NOTICES.md）
- [x] htmlparser2オーバーライドの存続可否をCIで自動チェック（scripts/check-htmlparser2-override.js）
- [x] favicon権限をoptional_permissionsに移動
- [x] AIプロンプトの言語フォールバックを多段階化（ko→en, zh→ja）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `fetchWithRetry`のリトライ制限テスト
- 429エラー時のリトライ抑制テスト
- 言語フォールバックの多段階テスト

### 統合テスト
- CIスクリプトのhtmlparser2オーバーライドチェック
- モバイルChromeでの権限安裝テスト

## 実装アプローチ
- **Outside-In**: 単体テスト（リトライ制限）→ 統合テスト（CI/権限）
- **Red-Green-Refactor**: 各テストが失敗することを確認してから実装

## 見積もり
5 ポイント（小規模）

## 技術的考慮事項
- 依存関係: なし（既存機能の改善）
- テスタビリティ: fetchモックでリトライ動作をテスト
- 非機能要件: コスト削減、ライセンス準拠

## 実装者向け注記

### 現状コードの確認
```bash
# fetchWithRetryの実装を確認
grep -n "fetchWithRetry\|maxRetryCount" src/background/ai/providers/OpenAIProvider.ts

# wa-sqliteのライセンス情報を確認
grep -A5 "wa-sqlite" package-lock.json | head -10

# favicon権限の場所を確認
grep -n "favicon" wxt.config.ts manifest.json 2>/dev/null

# AIプロンプトの言語判定を確認
grep -n "getBrowserLocale\|language" src/utils/customPromptUtils.ts
```

### 実装状況（2026-06-11 時点）

> **ジュニア開発者向け**: このセクションは「何が既に実装されていて、何が残っているか」をまとめたものです。

#### 実装済み（コード確認済み）

| 受け入れ基準 | 場所 | 状態 |
|------------|------|------|
| favicon権限を optional_permissions に移動 | `wxt.config.ts` L39〜40 | ✅ 実装済み |
| htmlparser2 オーバーライドチェックスクリプト | `scripts/check-htmlparser2-override.js` | ✅ 実装済み |
| AI プロンプトの言語フォールバック（ko→en, zh→ja） | `src/utils/customPromptUtils.ts` L83〜84 | ✅ 実装済み |

#### 残タスク（未実装）

**1. fetchWithRetry のタイムアウト時リトライを1回に制限する** ← **オーナー決定: 実装する**

確定した変更方針:
- `AbortError`（タイムアウト）: 最大1回リトライ（合計2回試行）
- HTTP 429: リトライなし（即座にエラー返却）
- HTTP 5xx: 変更なし（最大3回リトライ）

実装場所: `src/utils/fetch.ts` の `fetchWithRetry` 関数

実装方法:
```typescript
// src/utils/fetch.ts の fetchWithRetry 内
// エラー種別を検出して、エラーごとに effectiveMaxRetry を計算する

// 現状の実装を確認してから変更する
// grep -n "AbortError\|429\|status\|maxRetryCount" src/utils/fetch.ts
```

実装イメージ（疑似コード）:
```typescript
// ループ内で catch したエラーに応じてリトライ上限を上書き
if (error instanceof Error && error.name === 'AbortError') {
  effectiveMaxRetry = Math.min(maxRetryCount, 1); // タイムアウトは最大1回
} else if (response?.status === 429) {
  break; // 429は即座に中断
}
```

**影響範囲**: `fetchWithRetry` を呼び出している全AIプロバイダー（OpenAI・Gemini）が対象。テスト接続（`maxRetryCount: 1`）は個別設定なので、タイムアウト制限との `Math.min` で影響なし。

**2. THIRD_PARTY_NOTICES ファイルの作成** ← **オーナー決定: dependencies 全件をリストアップ**

`package.json` の `dependencies` 全件のライセンスを記載する。

作業手順:
```bash
# 1. ライセンス一覧を自動生成（license-checker を一時的に使う）
npx license-checker --production --csv --out /tmp/licenses.csv

# 2. 出力を確認して THIRD_PARTY_NOTICES.md を作成
```

作成場所: プロジェクトルートの `THIRD_PARTY_NOTICES.md`

ファイルの内容テンプレート:
```markdown
# Third Party Notices

## wa-sqlite

Copyright (c) [年] [著作権者名]

MIT License（全文をここに記載）
```

#### 設計上の意思決定

**なぜ favicon を optional_permissions にするのか？**
Chrome のインストール画面では、必須権限は「このアプリはあなたの〇〇にアクセスします」という警告として表示される。`favicon` が必須権限だとインストール時に余計な警告が出てユーザーがびっくりする。オプション権限にすることで警告を消し、必要になった時に初めてリクエストできる。

**fetchWithRetry のリトライ戦略の考え方**
- タイムアウト（`AbortError`）: サーバーが重い状態。1回だけリトライして諦める。2回以上は「貧すれば鈍する」でトークンを無駄遣いする。
- 429（レートリミット）: リトライするほど悪化する（Retry-After ヘッダーを読んで待てるなら別だが、実装が複雑になる）。即座にエラーを返してユーザーに通知。
- 5xx（サーバーエラー）: 一時的な障害の可能性が高い。3回リトライで合理的。

**htmlparser2 オーバーライドの背景**
Node.js 22+ での ESM 対応の問題で、古い htmlparser2 のバージョンとの非互換が生じた。`package.json` の `overrides` で強制的に新バージョンを使うことで回避している。`scripts/check-htmlparser2-override.js` は「オーバーライドがもう不要になったか？」を自動チェックするスクリプト。Node.js がアップデートされるたびに確認する。

**AI プロンプトの言語フォールバック多段階化の意味**
- `ko`（韓国語）→ `en`（英語）フォールバック: 英語で書かれた学術資料が多いため英語プロンプトの方が精度が高い
- `zh`（中国語）→ `ja`（日本語）フォールバック: 日本語プロンプトの方が文化的近似度が高い
- `ja` と `en` のプロンプトのみ高品質なものを用意し、他の言語はこれらにフォールバックさせる設計

### 実装手順
1. `fetchWithRetry`のリトライ制限を実装（タイムアウト1回、429は0回）— **未実装（要対応）**
2. `npm install`を再実行してwa-sqliteのライセンス情報を取得 — `package-lock.json` 確認済み
3. third-party-noticesファイルを作成/更新 — **未実装（要対応）**
4. CIスクリプトにhtmlparser2オーバーライドチェックを追加 — **実装済み（`npm run check-htmlparser2`）**
5. favicon権限をoptional_permissionsに移動 — **実装済み**
6. AIプロンプトの言語フォールバックを多段階化 — **実装済み（ko→en, zh→ja）**

### 落とし穴
- `fetchWithRetry`のリトライ制限はステータスコードごとに設定 → `AbortError` と HTTPステータスコードで分岐が必要
- wa-sqliteのライセンスは MIT → THIRD_PARTY_NOTICES.md に全文記載
- htmlparser2オーバーライド削除後はNode.js 24以下でテストが失敗する可能性 → `check-htmlparser2-override.js` スクリプトで自動チェック
- favicon権限は `chrome.tabs.get()` の `favIconUrl` で代替可能だが、現状は optional_permissions で対応済み

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（fetchWithRetryのタイムアウト1回・429リトライなしテストを fetch.test.ts に追加済み）
- [x] テストカバレッジが基準を満たす
- [x] コードレビュー完了
- [x] リファクタリング完了
- [x] ライセンス文書更新済み（THIRD_PARTY_NOTICES.md）
