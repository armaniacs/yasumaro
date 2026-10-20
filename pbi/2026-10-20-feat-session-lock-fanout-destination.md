# PBI: 自動ロック通知の fan-out 宛先を修正し、開いている拡張ページが確実にロックを反映する

優先度: 低（UX 副作用の設計判断込み） / RICE: 100（参考値。Reach=1 / Impact=0.5 / Confidence=0.5 / Effort=1）
種別: feat（UX 挙動変更を伴うため親 PBI から分離）
親 PBI: `pbi/2026-10-18-20-fix-session-lock-fanout.md`（選択肢 2+3 は完了・アーカイブ済み。本 PBI は選択肢 1 の宛先修正のみ）

## ユーザーストーリー

自動ロックを有効にしている利用者として、ロックが発火したときに開いている拡張ページ（popup / dashboard）にも確実にロック状態が反映されてほしい、なぜなら宛先が空回りしている間は、ページ側が古い（ロック解除済みの）キャッシュ状態を表示し続けるから。

## 背景（親 PBI での調査結果）

- `SESSION_LOCK_REQUEST` は `messageTypeRegistry.ts:39`（service-worker 宛て型）と `:74`（`NO_PAYLOAD_TYPES`）に載っているが、`src/` 全体で `chrome.runtime.onMessage.addListener` を呼ぶのは 4 箇所（`service-worker.ts:226` / `offscreen.ts:165` / `aiTestProgressLockClient.ts:75` / `privacyConsent.ts:331`）だけで、`SESSION_LOCK_REQUEST` を処理するのは service worker 自身のみ。fan-out は構造的に空回りする。
- MV3 のプラットフォーム事実: `chrome.runtime.sendMessage` は送信者自身のリスナーに配送されない。service worker から service worker 自身への通知は届かないため、宛先修正は「他コンテキスト（popup / dashboard / offscreen）にリスナーを足す」か「SW 内直接呼び出しへの差替え」のどちらかになる。
- 親 PBI で選択肢 2（応答本文での成功判定）+ 選択肢 3（消費側の `IS_LOCKED` 検査をキャッシュ非依存へ移動）は実装済み。未確認配送は "never confirmed" ログで観測可能。

## 実装の選択肢

1. **拡張ページへのリスナ追加**: popup / dashboard のエントリで `SESSION_LOCK_REQUEST` を受け取り、`authGuard` のロック状態を再読み込みする。fan-out の「受け手」を本物にする。副作用 🔴: 開いているコンテキストを能動的にロックする UX 挙動を持つため、鍵の UI 状態が突然変わる設計判断が要る。
2. **SW 内直接呼び出しへの差替え**: fan-out を廃止し、`lockSession()` がロック処理を完結させたうえで、拡張ページには既存の状態同期経路（storage change observer 等）で反映する。副作用 🔴: ページ側の状態同期のタイミング設計が要る。

どちらを採るかは「開いているページを即座にロック表示にする」UX を採るかどうかの製品判断を含むため、本 PBI は親から分離した。

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
    And 上限到達時は "never confirmed" ログを残す
```

## テスト戦略

1. 宛先の受信処理を純関数（または seam 経由のハンドラ）として切り出し、単体テストでロック状態遷移を pin する
2. fan-out 成功判定は親 PBI で導入した応答本文ベースの契約を再利用し、再試行・未確認ログを既存テストと同じ形で pin する
3. 統合テスト: `SessionAlarmService.test.ts` の fake ポートに受け手側ハンドラを追加し、ロック反映を観測する

## ブロッカー

- 実機観測: 開いている拡張ページでのロック反映（owner による手動確認）を受入基準 1 の E2E 相当として残置する
- 製品判断: 選択肢 1 vs 2 の裁定（UX 副作用 🔴）をユーザー確認のうえ決める

## ロールバック

- 宛先追加はリスナ 1 箇所の削除で戻せる。直接呼び出しへの差替えを選んだ場合は fan-out 経路の復元で戻す

## 関連

- `pbi/00-INDEX.md`
- 親 PBI: `dev-docs/archived/pbi/2026-10-18-20-fix-session-lock-fanout.md`（選択肢 2+3 の実装記録・プラットフォーム事実注釈）
- `src/utils/messaging/types.ts`（`SESSION_LOCK_REQUEST` の応答契約 `{ success: true }`）
- `src/utils/storage/authGuard.ts`（拡張ページ側のロック状態の参照先）
- `dev-docs/ARCHITECTURE_MAP.md`（popup / dashboard のエントリ位置）
