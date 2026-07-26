# PBI: Offscreen Document内の生console出力をService Worker経由のログ中継機構に置き換える

**作成日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（Offscreen Documentは直接chrome.storageやloggerモジュールにアクセスできない制約があるため、メッセージバス経由の中継実装が必要）

---

## 背景

`2026-07-25-17-...`ではなく`2026-07-26-17-refactor-console-to-structured-logger.md`（PBI-17）から
分割。同PBIで`src/dashboard/cspSettings.ts`（dashboard側、直接`addLog()`呼び出し可能）の8件は
`addLog()`呼び出しに置き換え済み。残る21件（`src/offscreen/offscreen.ts`(9件),
`src/offscreen/opfsWorker.ts`(6件), `src/offscreen/sqliteEngineContext.ts`(6件)）は
Offscreen Document / Workerコンテキストのため、既存の`logger.ts`（`addLog`）を直接呼び出せず、
メッセージパッシング経由でService Workerにログを中継する新規機構の設計・実装が必要となり、
規模が大きいため分割した。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "console\." src/offscreen/offscreen.ts src/offscreen/sqliteEngineContext.ts src/offscreen/opfsWorker.ts
```

`sqliteEngineContext.ts`の既存のメッセージ送受信パターンを参考に、Offscreen→Service Worker方向の
ログ中継メッセージ型（例: `LOG_FORWARD`）を`src/background/messageTypes.ts`に追加することを検討する。
`opfsWorker.ts`はWorkerコンテキスト（`postMessage`ベース）のため、さらに別の中継経路が必要になる
可能性がある点に注意する。

## 受け入れ基準（BDD）

```gherkin
Scenario: OffscreenのconsoleがService Worker経由でログ中継される
  Given src/offscreen/offscreen.ts, opfsWorker.ts, sqliteEngineContext.tsのconsole.*呼び出し
  When メッセージバス経由でService Workerにログを送信する仕組みに置き換える
  Then Service Worker側でaddLog()を通じて構造化ログとして保存される

Scenario: 既存の動作が回帰しない
  Given ログ出力方式を変更した後のコード
  When 既存のoffscreen関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] Offscreen宛のログ中継メッセージ機構を設計・実装する（既存のメッセージ型に`LOG_FORWARD`等を追加）
- [ ] Offscreen側の21件のconsole出力をログ中継機構経由に置き換える
- [ ] Workerコンテキスト（`opfsWorker.ts`）特有の中継経路が必要か確認し、必要であれば実装する
- [ ] 既存の関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- ログ中継メッセージが正しい形式で送信されることを確認
- Service Worker側で中継メッセージを受信し`addLog()`が呼ばれることを確認

### 統合テスト
- Offscreen Document起動からログ中継、Service Worker側でのログ保存までの一連の流れを確認

## 実装アプローチ

1. Offscreen側のログ中継メッセージ型を設計（`src/background/messageTypes.ts`に追加）
2. Offscreen側でのログ送信ヘルパー関数を作成し、各ファイルのconsole呼び出しを置き換える
3. Service Worker側でメッセージを受信し`addLog()`を呼ぶハンドラーを追加
4. `opfsWorker.ts`（Workerコンテキスト）は別途中継経路を検討

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/logger.ts`, `src/background/messageTypes.ts`
- テスタビリティ: メッセージパッシングのモックが必要
- 非機能要件: 可観測性（SRE/Ops）、セキュリティ（PIIサニタイズ）

## Definition of Done
- [ ] Offscreen側のconsole出力がログ中継機構経由になっている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- 分割元PBI: `dev-docs/archived/pbi/2026-07-26-17-refactor-console-to-structured-logger.md`（dashboard側は対応済み）
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（SRE/Ops Specialist, Blue Team Leader, DX Advocate指摘）
- 対象コード: `src/offscreen/offscreen.ts`, `src/offscreen/sqliteEngineContext.ts`, `src/offscreen/opfsWorker.ts`

## 実装メモ（2026-07-26完了）

3つのファイルは実行コンテキストが異なるため、それぞれ別の対応をした:

- **`src/offscreen/offscreen.ts`（9件）**: Offscreen Documentのメインスレッドだが
  `chrome.storage`は使えても`chrome.runtime.onMessage`受信専用（能動送信はしていなかった）。
  新規`src/offscreen/offscreenLogger.ts`を作成し、`chrome.runtime.sendMessage({ type: 'LOG_FORWARD', ... })`
  でService Workerへログを転送するヘルパー（`forwardWarn`/`forwardError`/`forwardInfo`）に置き換えた。
  Service Worker側は`src/background/handlers/messageHandlers.ts`の`createLogForwardHandler()`が
  受信し`logWarn`/`logError`/`logDebug`を呼ぶ（`src/background/messageTypes.ts`に`LogForwardMessage`型と
  `LOG_FORWARD`を`VALID_MESSAGE_TYPES`へ追加、`service-worker.ts`に`registry.register('LOG_FORWARD', ...)`登録）
- **`src/offscreen/sqliteEngineContext.ts`（6件）**: 調査の結果、既に`../utils/logger.js`から
  `logError`/`logWarn`/`logInfo`をimportして使用済みだったことが判明（`logger/core.ts`の`flushLogs()`が
  `chrome.storage`未対応環境ではconsoleにフォールバックする設計のため、Offscreenでも直接呼び出し可能）。
  残っていた6件もそのまま`logWarn`/`logError`に置き換えるだけで済んだ（新規機構は不要）
- **`src/offscreen/opfsWorker.ts`（6件、真のWeb Workerコンテキスト）**: `chrome.*`に一切アクセスできない
  ため、既存の`RequestMessage`/`ResponseMessage`プロトコルとは別に`WorkerLogMessage`
  （`{ __log: true, level, message, details }`）という専用フォーマットを`self.postMessage`で
  `sqliteEngineContext.ts`に送信する`postWorkerLog()`ヘルパーを追加。受信側の`worker.onmessage`に
  `isWorkerLogMessage()`型ガードで判別する分岐を追加し、`logWarn`/`logError`/`logInfo`を直接呼ぶ
  （Service Worker中継は不要、offscreen document内で完結）
- テスト環境（jsdom）では`self`が`Window`扱いになり`postMessage`が`targetOrigin`必須の2引数版になる
  ため`postWorkerLog`内にtry-catchでconsoleフォールバックを追加。同様に`chrome.runtime.sendMessage`が
  Promiseを返さないモック環境に対応するガードも`offscreenLogger.ts`に追加
- 既存テスト2件（`offscreen.test.ts`の`console.error`引数期待値、`messaging/types.test.ts`の
  `VALID_MESSAGE_TYPES`網羅テストに`LOG_FORWARD`ペイロード例を追加）を更新
- `npm run type-check`・全7267テスト・`npm run build`とも成功
