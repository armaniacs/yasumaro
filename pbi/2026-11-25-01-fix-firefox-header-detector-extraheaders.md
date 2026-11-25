# PBI: Firefox の HeaderDetector が extraHeaders 指定で初期化失敗する不具合を修正する

## ユーザーストーリー
Firefox で Yasumaro を使う利用者として、プライベートページの HTTP ヘッダー検出(`Cache-Control: private` 等)と Webhook エクスポートが Chrome / Edge と同じく機能してほしい、なぜなら現状は `headerDetector.initialize()` が Chromium 専用オプション `'extraHeaders'` を無条件で渡して例外で失敗し、Firefox ではヘッダー判定キャッシュが常に空になってプライベート判定が無効化され、Webhook 送信も全件 `blocked (privacy-verdict-absent)` になるから。

## 優先度
- 発見元: PBI 2026-11-24-08(正式版前の実機スモークテスト、`npm run smoke:ga` Firefox Developer Edition 159.0b4 実機検証)
- RICE スコア: 18.0(Reach 6 × Impact 3 × Confidence 1.0 ÷ Effort 1 = 18.0)
  - Reach 6: Firefox 利用者全員
  - Impact 3: プライバシー保護(`Cache-Control: private` 検出)と Webhook エクスポートの両方が Firefox で全面停止している実害を解消
  - Confidence 1.0: `src/background/headerDetector.ts:64` の `'extraHeaders'` が原因と実機・仕様両面で確定
  - Effort 1: フォールバック処理と単体テスト追加、実機 Firefox スモーク再検証
- 依存: PBI 2026-11-24-08 の完了・GA 提出の前提ブロッカー

## ビジネス価値
- Firefox のプライベートページ HTTP ヘッダー検出(`Cache-Control: private` / `Set-Cookie` 等)が正常動作する
- Firefox での Webhook エクスポートがプライバシー判定キャッシュを参照して正当に送信される
- 測定方法: 単体テストで Firefox 相当(`extraHeaders` 非対応)のフォールバック登録が緑になり、実機 Firefox Developer Edition 159 で `npm run smoke:ga -- --browsers=firefox --flows=7,10` が全緑になること

## BDD受け入れシナリオ

```gherkin
Scenario: Chromium 系では従来どおり extraHeaders 付きで webRequest リスナーを登録する
  Given chrome.webRequest.onHeadersReceived.addListener が ['responseHeaders', 'extraHeaders'] を受け付ける
  When  HeaderDetector.initialize() を実行する
  Then  addListener は ['responseHeaders', 'extraHeaders'] で 1 回だけ呼ばれる

Scenario: Firefox など extraHeaders 非対応環境では responseHeaders のみへフォールバックして登録を完了する
  Given chrome.webRequest.onHeadersReceived.addListener が 'extraHeaders' 指定時に TypeError を投げる
  And   ['responseHeaders'] のみの指定は成功する
  When  HeaderDetector.initialize() を実行する
  Then  addListener が ['responseHeaders'] で再試行されて成功する
  And   HeaderDetector initialization failed エラーは記録されない
  And   Firefox 実機スモークの項目 10(Webhook)が blocked (privacy-verdict-absent) にならず送信成功する

Scenario: フォールバック先も失敗した場合は従来どおりエラーログを記録する
  Given chrome.webRequest.onHeadersReceived.addListener が常に例外を投げる
  When  HeaderDetector.initialize() を実行する
  Then  HeaderDetector initialization failed がエラーログに記録される
```

## 受け入れ基準
- [x] `HeaderDetector.initialize()` が `['responseHeaders', 'extraHeaders']` で例外を受けたとき `['responseHeaders']` で再試行し、Firefox でも `onHeadersReceived` リスナーが登録される
- [x] Chromium 系ブラウザでは従来どおり `['responseHeaders', 'extraHeaders']` で 1 回だけ登録される
- [x] 再試行も失敗した場合は従来どおり `logError('HeaderDetector initialization failed', ...)` を記録する
- [x] `src/background/__tests__/headerDetector.test.ts` に上記 3 分岐の単体テストがある
- [x] 実機 Firefox Developer Edition 159 で配布用ビルド(`OW_E2E_PROBE=0`)を作り直し、`npm run smoke:ga -- --browsers=firefox` で項目 7・項目 10 が緑になる
- [x] `npm run validate` が緑(文字種検査を含む)

## テスト戦略(t_wadaスタイル)

### E2E / 実機スモークテスト
- 修正後の Firefox 配布用 ZIP(`OW_E2E_PROBE=0`)で `npm run smoke:ga -- --no-assisted --browsers=firefox` を実行し、項目 7・項目 10 を含む全 10 フローの緑を確認する

### 統合テスト
- 実機 Firefox での `onHeadersReceived` → `RecordingCache` → `webhookExportStep` の貫通を GA スモークの項目 10 で検証する

### 単体テスト
- `src/background/__tests__/headerDetector.test.ts` に以下を先に書いて赤を確認してから実装する:
  1. `extraHeaders` が通る環境では 1 回呼び出しで完了する
  2. `extraHeaders` で `TypeError` を投げる環境(Firefox)では `['responseHeaders']` へフォールバックし、`logError` を呼ばず成功する
  3. 両方失敗した場合は `logError` を呼ぶ

## 実装アプローチ
- **Outside-In / Red-Green-Refactor**: `headerDetector.test.ts` に Firefox の `TypeError: Invalid enumeration value "extraHeaders"` を再現するテストを追加(赤)→ `HeaderDetector.initialize()` にフォールバックを実装(緑)→ リファクタリング・全検証

## 見積もり
1 ストーリーポイント

## 技術的考慮事項
- Chromium 系で `'extraHeaders'` を外してはならない(`Set-Cookie` 等のヘッダー取得に必要なため)。try/catch フォールバックにより Chromium の挙動は完全不変とする
- フォールバック成功時は `logInfo` で `extraHeaders` なしで初期化した旨を診断ログに残す

## Definition of Done
- [x] 全 BDD シナリオが単体テストおよび実機 Firefox スモークで検証されている
- [x] `npm run validate` が緑
- [x] 実機 3 ブラウザ(Chrome / Edge / Firefox)スモークで項目 7・10 が緑
- [x] 文書は Shift-JIS 範囲の文字のみ(`npm run check:docs-chars` 緑)

## 引き継ぎ
状態: 完了(2026-11-25)。`src/background/headerDetector.ts` の `'extraHeaders'` フォールバック実装、`headerDetector.test.ts`(26/26) 緑、`npm run validate`(1,366 ファイル / 19,224 テスト) 緑、実機 Firefox Developer Edition 159 の配布用 ZIP 再ビルドで項目 10(Webhook) 886ms PASS を確認済み。
