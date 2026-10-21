# PBI: 自動ロック fan-out の宛先追加（popup / dashboard にリスナを足す）

## ユーザーストーリー

自動ロックを有効にしている利用者として、ロックが発火したときに開いている拡張ページ（popup / dashboard）にも確実にロック状態が反映されてほしい、なぜなら宛先が空回りしている間は、ページ側が古い（ロック解除済みの）キャッシュ状態を表示し続けるから。

## 優先度

- 種別: feat（UX 挙動変更を伴う・owner 判断 PBI 2026-10-20-feat-session-lock-fanout-destination の選択肢 1）
- 難易度: 🟡中
- 副作用: 🔴あり（開いているコンテキストを能動的にロック状態へ遷移させる UX 挙動を持つ。owner 判断 2026-10-21 で選択肢 1 を採用）
- 出典: [pbi/2026-10-20-feat-session-lock-fanout-destination.md](2026-10-20-feat-session-lock-fanout-destination.md)・親 PBI dev-docs/archived/pbi/2026-10-18-20-fix-session-lock-fanout.md。なぜなぜ分析 /tmp/whywhy/owner-pbi.md（分析 8-9）2026-10-21

## 前提

- 親 PBI の選択肢 2（応答本文での成功判定）+ 選択肢 3（消費側の IS_LOCKED 検査をキャッシュ非依存へ移動）は実装済み（never confirmed ログ導入済み）
- MV3 のプラットフォーム事実: chrome.runtime.sendMessage は送信者自身のリスナーに配送されない。service worker から自身への通知は届かないため、宛先は他コンテキストへの追加になる

## 実装内容

1. popup / dashboard のエントリで SESSION_LOCK_REQUEST を受け取るリスナを追加し、authGuard のロック状態を再読み込みする（fan-out の「受け手」を本物にする）
2. 受け手の受信処理を純関数（または seam 経由のハンドラ）として切り出し、単体テストでロック状態遷移を pin する
3. fan-out 成功判定・再試行・未確認ログは親 PBI で導入した応答本文ベースの契約を再利用する（既存 pin を維持）
4. 受け手パターンは既存のリスナ（aiTestProgressClient / privacyConsent）を流用する

## 受け入れ基準（BDD）

```gherkin
Scenario: ロック発火時に開いている dashboard がロック状態へ遷移する
  Given 自動ロックが有効で dashboard を開いている
    And 拡張ページの authGuard はロック解除済み状態を保持している
  When セッションタイムアウトで lockSession() が発火する
  Then dashboard の UI はロック状態を表示する
    And 鍵キャッシュは null になっている

Scenario: 拡張ページが開いていない場合でも fan-out は失敗しない
  Given popup / dashboard を開いていない
  When lockSession() が発火する
  Then ロック処理自体は完了する
    And 未確認配送のログは観測可能なまま残る

Scenario: ロック通知の再試行は親 PBI の契約を維持する
  Given 受け手が 2 回失敗応答を返す
  When lockSession() が fan-out する
  Then 3 試行・2 待機の既存セマンティクスを維持する
    And 上限到達時は never confirmed ログを残す
```

## テスト戦略

- 統合テスト: SessionAlarmService.test.ts の fake ポートに受け手側ハンドラを追加し、ロック反映を観測する
- 実機観測（開いている拡張ページでのロック反映）は owner 手動確認として残置する

## 関連

- [pbi/2026-10-20-feat-session-lock-fanout-destination.md](2026-10-20-feat-session-lock-fanout-destination.md)（親 PBI）
- dev-docs/archived/pbi/2026-10-18-20-fix-session-lock-fanout.md（選択肢 2+3 実装済み）
- src/utils/storage/authGuard.ts（拡張ページ側のロック状態の参照先）
