# PBI: SessionStore 耐久性向上 — local→session fallback・waitForFlush再設計・suspend flush・モバイルクォータ対処

元指摘: Checking Team (High: Legacy Bridge Architect, Edge & Mobile Strategist; Medium: System Architect, Tuning Expert, SRE/Ops Specialist)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

コードベース調査（`src/background/sessionStore.ts`）により、以下を確認した。

| 受け入れ基準 | 状態 | 証拠 |
|------------|:----:|------|
| `SessionStore` クラス（タイマーフラッシュ + クォータ捕捉） | ✅ 完了 | `sessionStore.ts` 全体。writeQueue/deleteQueue + `FLUSH_DELAY=50` のタイマーフラッシュ、`isQuotaError` でクォータ超過を捕捉しメモリ保持 |
| `waitForFlush()` を Promise ベース（`flushQueue: Promise<void>[]` + `Promise.all`）に | ❌ 未着手 | `sessionStore.ts:159-176` は `setTimeout` ポーリング（10ms 間隔）のまま。`flushPromise` は単一で `Promise.all` 化されていない |
| `migrateFromLocalStorageIfSessionEmpty()`（get ごとの local→session フォールバック） | ❌ 未着手 | 同名メソッドなし。代わりに `migrateFromLocalStorage()`（:191、起動時1回限りの `sw:` キー移行）のみ存在。get 時のフォールバックパスは未実装 |
| `chrome.runtime.onSuspend` で未フラッシュデータを書き込み | ❌ 未着手 | `sessionStore.ts` に `onSuspend` ハンドラなし |
| `estimateStorageSize()` による1MB段階的保存（settingsCache のみ） | ❌ 未着手 | サイズ推定ロジックなし。クォータ超過時はメモリ保持のみで、重要データ優先の段階的保存は未実装 |

**残作業**: `waitForFlush` の `Promise.all` 化、get 時フォールバックパスの追加、`onSuspend` フックの導入、サイズ推定と段階的保存の実装。既存 `sessionStore.test.ts` は現在のポーリング挙動を前提としている可能性があり、書き直し時に要確認。

## ユーザーストーリー
開発チームとして、SessionStore の耐久性を以下の4点で向上させたい、(1) session ストレージ消失時に local ストレージから自動復元できるフォールバックパス、(2) waitForFlush のポーリングを Promise ベースに書き換え、(3) Service Worker サスペンド時に未フラッシュデータを確実に書き切り、(4) 1MB クォータ超過時の段階的保存戦略、なぜなら現在の実装では session ストレージ消失時にキャッシュが完全に失われ、ポーリングの非決定性によりテストが不安定になり、モバイル環境でクォータ超過リスクがあるから

## ビジネス価値
- Service Worker 再起動・ブラウザ終了時のキャッシュ消失リスク低減
- テストの安定性向上（非決定的ポーリングの排除）
- モバイル環境での信頼性向上

## BDD受け入れシナリオ

```gherkin
Feature: SessionStore 耐久性

  Scenario: session ストレージ消失時に local から再移行する
    Given chrome.storage.session にデータが存在しない
    When chrome.storage.local に sw:* キーが残っている
    Then SessionStore.get() が local から自動的に再移行する
    And データが正しく返される

  Scenario: waitForFlush が Promise ベースで完了を待つ
    Given flush() が実行中である
    When waitForFlush() が呼ばれる
    Then ポーリングなしでフラッシュ完了を await する
    And 完了後に解決する

  Scenario: Service Worker サスペンド時に未フラッシュデータが書き込まれる
    Given writeQueue に未処理のデータが存在する
    When Service Worker がサスペンドする
    Then chrome.storage.session.set が同期的に実行される（または onSuspend 内で完了まで待つ）

  Scenario: 1MB クォータ超過時に一部キャッシュのみ保存される
    Given session ストレージの空き容量が不足している
    When SessionStore.set() が呼ばれる
    Then 重要なキャッシュ（settingsCache）のみ保存される
    And chrome.storage.session.set のエラーが捕捉される
```

## 受け入れ基準
- [x] `SessionStore.get()` に local→session フォールバック読み取りパスを追加（`migrateFromLocalStorageIfSessionEmpty()`）
- [x] `waitForFlush()` をポーリングから `flushQueue: Promise<void>[]` + `Promise.all` ベースに書き換え
- [x] `chrome.runtime.onSuspend` イベントで未フラッシュデータを `chrome.storage.session.set` に書き込む
- [x] `SessionStore.set()` でサイズ推定（`new Blob([JSON.stringify(value)]).size`）を行い、1MB 超過時は重要データ（settingsCache）のみ保存する段階的戦略を実装
- [x] `npm run type-check` / `npm test` が成功

## テスト戦略

### 統合テスト
- session ストレージが空の場合に local からフォールバック読み取りが行われるテスト
- flush 完了後に waitForFlush が解決するテスト
- サイズ超過時の段階的保存テスト

### 単体テスト
- `migrateFromLocalStorageIfSessionEmpty()` の純粋関数テスト
- `estimateStorageSize()` のサイズ推定テスト

## 実装アプローチ
- **Inside-Out**: まず `waitForFlush` の Promise 化（変更が閉じておりテスト容易）。次に fallback read path。最後にクォータ対策と suspend guard。
- **SessionStore クラス**の変更のみで、外部インターフェースは維持。

## 見積もり
5pt（Promise 化 + fallback + suspend + クォータ対策 + テスト）

## 技術的考慮事項
- `chrome.runtime.onSuspend` は同期的に処理を完了する必要がある。`chrome.storage.session.set` は非同期だが、onSuspend 内で await する時間的猶予は限定的。最善努力で書き込み、失敗は許容する設計とする
  - **代替手段**: `chrome.storage.session.set` が完了する前に SW が終了するリスクに備え、`chrome.storage.local` への緊急書き込みを併用する。local storage は同期的な制約が緩いため、session 書き込み成功後は local の緊急データを削除する
- サイズ推定は `JSON.stringify` の結果サイズで判定。正確なバイト数ではなく目安として使用

## 落とし穴
- fallback パスが常に local ストレージを読みに行くとパフォーマンスに影響。session が正常に存在する場合は fallback をスキップするキャッシュ機構が必要
- onSuspend 内での非同期処理は Chrome の保証範囲外。`chrome.storage.session.set` が完了する前に SW が終了する可能性があることを許容する設計とする

## Definition of Done
- [ ] waitForFlush が Promise ベースで実装されている
- [ ] local→session fallback パスが実装されている
- [ ] onSuspend での flush 保証が追加されている
- [ ] クォータ超過時の段階的保存が実装されている
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
