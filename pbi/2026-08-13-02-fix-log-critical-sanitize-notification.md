# PBI: logCriticalのOS通知にサニタイズ済みメッセージを渡し、PII漏洩を防ぐ

## ユーザーストーリー
Yasumaro拡張機能のユーザーとして、重大エラー通知（OS通知）にAPIキーなどの機密情報がそのまま表示されないでほしい、なぜなら通知はストレージ内ログより露出範囲が広く（画面共有・スクリーンショット・覗き見等）、意図せず機密情報を第三者に見られるリスクがあるから。

## ビジネス価値
拡張機能全体のPIIマスキング機構(`sanitizeRegex`)が保証する「機密情報を露出させない」というセキュリティ方針を、ストレージ保存経路だけでなくOS通知経路にも一貫して適用する。既存の`docs/PRIVACY.md`が謳う「データはローカル処理」という前提を、ローカル内でも不必要に露出させないという意味で補強する。

## 背景・根本原因（なぜなぜ分析より）
`src/utils/logger/api.ts` の `logCritical()` は、`createStructuredLog`で作った`entry`を`writeStructuredLog`（内部で`addLog`を呼びPIIマスキングされてストレージに保存される）に渡す一方、`sink.raise(message, details, errorCode)`（201行目）には**関数引数の生の`message`**をそのまま渡している。

`sanitizeRegex`によるPIIマスキングは`addLog`内部（`src/utils/logger/core.ts`）にのみ実装されており、ストレージ保存経路のみに適用される。`ChromeNotificationCriticalSink.raise`（`src/utils/logger/criticalAlertSink.ts`）はこの生メッセージを`chrome.notifications.create`のbodyにそのまま使い、OS通知として画面に表示する。

根本原因は、`logCritical`が「ログ保存」と「OS通知」という2つの異なるリスクレベルの出力チャネルを1つの関数で扱っているにもかかわらず、PIIサニタイズが片方（ストレージ経路）にしか実装されておらず、「出力チャネルによって露出リスクが異なる」という観点が設計に反映されてこなかったこと。現状の呼び出し元（`sqliteAlert.ts`等）は機密情報を含まない定型メッセージのみを渡しているため実害が顕在化していないが、将来`catch (e) { logCritical(e.message) }`のような一般的なエラーハンドリングパターンが追加されると、例外メッセージに含まれうるAPIキーやURL等がそのまま通知に露出する。

## 修正方針
`logCritical`内で`sink.raise`に渡す`message`を、`sanitizeRegex`でサニタイズ済みの文字列に置き換える。`sanitizeRegex`は既に`src/utils/piiSanitizer.ts`に実装され`src/utils/logger/sanitize.ts`経由で利用可能なため、`api.ts`から直接（または`sanitize.ts`経由で）呼び出して`message`をサニタイズしてから`sink.raise`に渡す。

## スコープ
- 対象: `src/utils/logger/api.ts` の `logCritical()` 関数のみ
- 対象外: `console.error`（191行目、開発者ツール向けデバッグ出力）へのサニタイズ適用は本PBIの対象外とする（別リスクレベルのチャネルであり、必要なら別PBIで検討）
- 対象外: `details`オブジェクトのサニタイズ（`sink.raise`には`details`もそのまま渡っているが、`ChromeNotificationCriticalSink`の実装が実際に`details`を通知本文に使っているかは別途確認が必要。今回は`message`のみを対象とする）

## BDD受け入れシナリオ

```gherkin
Scenario: logCriticalに機密情報を含むメッセージを渡すとOS通知ではマスキングされる
  Given logCriticalの呼び出し元が "APIキー sk-abc123... の検証に失敗しました" のようなAPIキーを含む文字列をmessageとして渡す
  When logCritical(message, details, errorCode) を呼び出す
  Then sink.raise に渡される message はサニタイズ済み（APIキー部分がマスキングされている）である
  And addLog によってストレージに保存されるログエントリの message も従来通りサニタイズされている

Scenario: 機密情報を含まないメッセージは従来通り通知に表示される
  Given logCriticalの呼び出し元が "SQLite同期に失敗しました" のような定型メッセージを渡す
  When logCritical(message, details, errorCode) を呼び出す
  Then sink.raise に渡される message はサニタイズ処理を経ても内容が変化しない（誤検知でマスキングされない）
```

## 受け入れ基準
- [ ] `logCritical`内で`sink.raise`に渡す`message`がサニタイズ済み文字列になっている
- [ ] `addLog`側（ストレージ保存経路）のサニタイズ挙動に変化がない（既存テストが壊れない）
- [ ] サニタイズ処理の追加により`logCritical`の実行時間が実用上問題ない範囲であること（`sanitizeRegex`が非同期処理のため、既存の`await`チェーンに自然に組み込む）
- [ ] 上記2シナリオが自動テストとして実装されパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（`chrome.notifications`はブラウザAPIでE2E環境での検証コストが高いため、統合テストで代替）

### 統合テスト
- `logCritical`を呼び出し、`CriticalAlertSink`のモック（スパイ）に渡される`message`引数を検証する。機密情報パターン（APIキー風文字列等）を含む入力でマスキングされていること、定型文字列で変化しないことの両方を確認する

### 単体テスト
- `sanitizeRegex`を直接呼び出すユニットテストは既存のものを流用（新規実装ではないため）
- `logCritical`内での`sink.raise`呼び出し引数を検証するテスト（`details`・`errorCode`は変化しないことも含めて確認）

## 実装アプローチ
- **Outside-In**: `sink.raise`に渡る`message`を検証する統合テストから書き始め、失敗を確認してから実装する
- **Red-Green-Refactor**: サニタイズ未適用の状態でテストが失敗することを確認 → `sanitizeRegex`呼び出しを追加してグリーンにする
- **リファクタリング**: グリーン後、`addLog`内のサニタイズ処理と`logCritical`内のサニタイズ処理でロジックの重複がないか確認する（同じ`sanitizeRegex`を呼ぶだけなので重複ロジックの問題は生じない想定）

## 見積もり
1pt 🟢（既存の`sanitizeRegex`を呼び出すだけの小さな変更）

## 技術的考慮事項
- 依存関係: なし（既存の`sanitizeRegex`を`src/utils/logger/sanitize.ts`または`src/utils/piiSanitizer.ts`から import する）
- テスタビリティ: `CriticalAlertSink`は既にDI可能な設計（`logCritical`の`sink`引数）なので、モックsinkを渡してスパイするテストが書きやすい
- 非機能要件: `sanitizeRegex`は既に`addLog`内で使われており非同期処理のパフォーマンス特性は既知。`logCritical`は元々複数の`await`を含む関数のため、追加のサニタイズ呼び出しによるレイテンシ増は無視できる範囲

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "sanitizeRegex" src/utils/piiSanitizer.ts src/utils/logger/sanitize.ts
grep -n "sink.raise\|createStructuredLog" src/utils/logger/api.ts
```
確認済み: `sanitizeRegex`は`src/utils/piiSanitizer.ts`に実装され、`src/utils/logger/sanitize.ts:1`でimportされ`sanitizeLogDetails`等から使われている（142行目で`sanitizeLogDetails`/`sanitizeArray`のみexport、`sanitizeRegex`自体は再exportされていないため、`api.ts`からは`../piiSanitizer.js`を直接importする必要がある）。`logCritical`は`src/utils/logger/api.ts:179-202`に実装されており、201行目の`sink.raise(message, ...)`が生の`message`をそのまま使っている。

### 実装手順
1. `src/utils/logger/api.ts`の先頭で`sanitizeRegex`を`../piiSanitizer.js`からimportする
2. `logCritical`内、`sink.raise`呼び出しの直前で`const sanitizedMessage = await sanitizeRegex(message);`を実行する
3. `sink.raise(sanitizedMessage, details as Record<string, unknown>, errorCode);`に置き換える
4. `console.error`（191行目）は対象外のためそのまま維持する
5. `writeStructuredLog(entry)`（187行目）に渡す`entry.message`は元々`addLog`内部でサニタイズされる経路のため変更不要

### 落とし穴
- `sanitizeRegex`は非同期関数（`Promise<string>`を返す）なので`await`を忘れないこと
- `sanitizeLogDetails`（`details`用）と`sanitizeRegex`（文字列単体用）は別関数。`message`は単一の文字列なので`sanitizeRegex`を直接使う
- `sink`引数はDIされたモックの場合があるため、テストでは`defaultCriticalSink`ではなくテスト用スパイsinkを渡して検証すること
- `details`オブジェクトのサニタイズは対象外（スコープ外）だが、既存の`ChromeNotificationCriticalSink`実装が`details`を通知本文にどう使っているか確認しておくと良い（もし`details`も通知本文に露出しているなら、別途スコープを広げる判断が必要になるため、実装前に`criticalAlertSink.ts`を確認すること）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック+テスト）がグリーン
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後の重複確認済み）
- [ ] `pbi/00-INDEX.md`に本PBIの行を追加
