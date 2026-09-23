# バックログ: arch-delivery-loop 0915 — アーキテクチャ診断（2026-09-15）

`arch-delivery-loop` による Phase 0 診断（3つのサブエージェント探索 + HTML レポート `/tmp/architecture-review-20260915.html`）で抽出した11候補の RICE スコア表。上位4件を PBI 化（02〜05・**2026-09-15 実装完了・アーカイブ済み**）、次点3件を第2ループで PBI 化（06〜08・2026-09-15）、残り4件は将来候補。

## RICE スコア表（全11候補・同基準）

| スコア順 | 候補 | R | I | C | E(人週) | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | 送信者検証 seam の一本化（AuthorizedSqliteSender） | 6 | 2 | 0.8 | 0.2 | **48.0** | ✅ PBI 02 完了 |
| 2 | queryPlanner⇄queryPlan 循環 import 解消 | 4 | 1 | 0.8 | 0.1 | **32.0** | ✅ PBI 03 完了 |
| 3 | archiveWireTable 派生化（5重投影の規律を構造で閉じる） | 14 | 1 | 0.8 | 0.4 | **28.0** | ✅ PBI 04 完了 |
| 4 | CleansingPresetStore 抽出（順序制約を interface に隠す） | 5 | 2 | 0.8 | 0.4 | **20.0** | ✅ PBI 05 完了 |
| 5 | diagnostics section のデータ駆動化 | 6 | 1 | 0.8 | 0.3 | 16.0 | → **PBI 06**（第2ループ） |
| 6 | Transport timeout/settle の重複除去 | 3 | 0.5 | 0.8 | 0.1 | 12.0 | → **PBI 07**（第2ループ） |
| 7 | consent module の深掘り（状態遷移の locality 回復） | 4 | 2 | 0.8 | 0.6 | 10.7 | → **PBI 08**（第2ループ） |
| 8 | ArchiveSessionStore 抽出（500行 mount の状態機械化） | 8 | 2 | 0.5 | 0.8 | 10.0 | → **PBI 09**（第3ループ） |
| 9 | createBackend のレジストリ化 | 6 | 1 | 0.5 | 0.4 | 7.5 | → **PBI 10**（第3ループ） |
| 10 | sqliteHistory presentation 抽出 | 4 | 1 | 0.5 | 0.5 | 4.0 | → **PBI 11**（第3ループ） |
| 11 | hmacKeyStore 候補チェーンの内部 seam | 3 | 0.5 | 0.5 | 0.2 | 3.75 | → **PBI 12**（第3ループ） |

## 実行順

```
第1ループ（2026-09-15）: 02 → 03 → 04 → 05 完了
第2ループ（2026-09-15）: 06 → 07 → 08 完了
第3ループ（2026-09-15）: 09 → 10 → 11 → 12（全11候補がこのループで閉じられる）
```
依存関係なし（互いに独立）。実装は直列で進める。

## 5 Whys サマリー（上位候補）

### PBI 02（送信者検証）
1. なぜ拡張ページが拒否された → sender.tab と chrome-extension:// 前提
2. なぜその前提 → 678f879d 時代の Chrome 動作に合わせた実装
3. なぜ修正が二重綴りになった → Firefox 修正を緊急で入れた際、senderTrust と offscreen の両方に散らばった
4. なぜ InPage が sender を捏造するのか → 検証 seam が transport から到達不能だった
→ 解: authorizeOffscreenSender SSOT + AuthorizedSqliteSender を渡す internal seam

### PBI 04（archiveWireTable）
1. なぜ 3 ファイルに手書き複製があるか → wireTable が gatewayDecode を持たず、派生を規律で代用してきた
2. なぜ silent-drop が起きるか → 5 重投影の一致が interface に書かれていない
→ 解: descriptor に gatewayDecode を追加し、残り2箇所を派生 Map に置換

### PBI 05（preset store）
1. なぜプリセット競合が起きたか → epoch・二重書き込み・ガード解除の順序が呼び出し側の知識
2. なぜ知識が漏れているか → 状態が applyPreset/migration/custom/復元 IIFE の4経路に分散
→ 解: PresetStore（4メソッド + 内部状態機械）に集約し chrome.storage 直打ちを消す
