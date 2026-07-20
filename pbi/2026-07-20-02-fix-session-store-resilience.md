# PBI: SessionStore 耐久性向上 — local→session fallback・waitForFlush再設計・suspend flush・モバイルクォータ対処

元指摘: Checking Team (High: Legacy Bridge Architect, Edge & Mobile Strategist; Medium: System Architect, Tuning Expert, SRE/Ops Specialist)

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
- [ ] `SessionStore.get()` に local→session フォールバック読み取りパスを追加（`migrateFromLocalStorageIfSessionEmpty()`）
- [ ] `waitForFlush()` をポーリングから `flushQueue: Promise<void>[]` + `Promise.all` ベースに書き換え
- [ ] `chrome.runtime.onSuspend` イベントで未フラッシュデータを `chrome.storage.session.set` に書き込む
- [ ] `SessionStore.set()` でサイズ推定（`new Blob([JSON.stringify(value)]).size`）を行い、1MB 超過時は重要データ（settingsCache）のみ保存する段階的戦略を実装
- [ ] `npm run type-check` / `npm test` が成功

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
