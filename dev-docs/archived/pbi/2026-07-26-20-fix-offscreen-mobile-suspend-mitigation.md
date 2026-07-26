# PBI: モバイルChromeでのOffscreen Documentサスペンド対策を実装する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（タイムアウト値の変更・ヘルスチェック追加により、SQLite操作のタイムアウト挙動が変わる）

## 実装メモ（2026-07-26）

フェーズ0確認で、`getPlatformOs()`は既に`sqliteClient.ts`コンストラクタでモバイル判定に使われて
いたが、それは`maxQueueSize`（リクエストキューサイズ）のためのみで、`MESSAGE_TIMEOUT_MS`
（10秒固定）はモバイル/デスクトップで区別されていなかったことを確認した。

`MESSAGE_TIMEOUT_MS`をモジュール定数から`MESSAGE_TIMEOUT_MS_DESKTOP`（10秒）/
`MESSAGE_TIMEOUT_MS_MOBILE`（5秒）の2定数に分離し、インスタンスプロパティ`messageTimeoutMs`として
コンストラクタで`getPlatformOs()`の結果に応じて決定する形に変更した。`sendOnce()`内のタイムアウト
参照もこのインスタンスプロパティ経由に統一。

ヘルスチェックping機構は、新規アラームを追加せず既存の`yasumaro-offline-network-retry`アラーム
（5分間隔）に`sqliteClient.isSqliteHealthy()`呼び出しを相乗りさせる形で実装した（完全なサスペンド
防止ではなく頻度低減が目的、というPBIの受け入れ基準に合致）。

この変更により`service-worker.test.ts`で`isSqliteHealthy()`失敗時に`sqliteAlert.ts`経由で
`addLog`が呼ばれるパスが初めて実行されるようになり、既存の`logger.js`モックに`addLog`/`LogType`が
不足していたことが顕在化したため追加した。

`sqliteClient-queue.test.ts`の既存キューサイズテストと同じパターン（`resetPlatformOsCache()` +
`navigator.userAgent`書き換え + `chrome.runtime.getPlatformInfo`モック）で、デスクトップ/モバイル
それぞれのタイムアウト値を検証するテストを2件追加した。

型チェック・全テストスイート（7373件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Edge & Mobile Strategist からの指摘。`src/background/sqliteClient.ts:159-176`（現状の行番号は前後する可能性あり）で、モバイル Chrome では Offscreen Document がアイドル後にサスペンドされる。SQLite 操作のたびに最大10秒のレイテンシが発生する可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "MESSAGE_TIMEOUT_MS\|getPlatformOs" src/background/sqliteClient.ts
```

`MESSAGE_TIMEOUT_MS` の現在値と、`getPlatformOs()` がどのように使われているか（既存の呼び出し実績があるか）を確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: モバイル端末でタイムアウト値が短縮される
  Given getPlatformOs() がモバイル（Android等）を検出する
  When SQLite操作のMESSAGE_TIMEOUT_MSを参照する
  Then デスクトップより短い値（例: 5000ms）が使われる

Scenario: デスクトップでは既存のタイムアウト値のままである
  Given getPlatformOs() がデスクトップを検出する
  When SQLite操作のMESSAGE_TIMEOUT_MSを参照する
  Then 既存のタイムアウト値が維持される

Scenario: 定期的なヘルスチェックでOffscreen Documentの生存を維持する
  Given Offscreen Documentがアイドル状態にある
  When 定期的なヘルスチェックping処理が実行される
  Then サスペンドされにくくなる（完全に防げなくても頻度が下がる）
```

## 受け入れ基準
- [ ] `getPlatformOs()` と連動し、モバイル検出時は `MESSAGE_TIMEOUT_MS` を短縮する（例: 5000ms）
- [ ] Offscreen Documentへの定期的なヘルスチェックping機構を検討・実装する（サスペンド頻度の低減が目的、完全防止ではない）
- [ ] 既存の `sqliteClient` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- モバイル検出時にタイムアウト値が短縮されることを確認
- デスクトップ検出時は既存値のままであることを確認

### 統合テスト（可能であれば）
- ヘルスチェックpingが定期的に送信されることを確認

## 実装アプローチ

1. `getPlatformOs()` の呼び出しを `sqliteClient.ts` に追加し、`MESSAGE_TIMEOUT_MS` を動的に決定する
2. ヘルスチェックping機構を設計・実装（既存のアラーム機構を活用）
3. テスト追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `getPlatformOs()`（既存ユーティリティ）
- テスタビリティ: プラットフォーム検出のモックが必要
- 非機能要件: モバイル対応、パフォーマンス

## Definition of Done
- [ ] モバイル検出時のタイムアウト短縮が実装されている
- [ ] ヘルスチェックping機構が実装されている（または見送りの判断が記録されている）
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Edge & Mobile Strategist指摘）
- 対象コード: `src/background/sqliteClient.ts:159-176`
