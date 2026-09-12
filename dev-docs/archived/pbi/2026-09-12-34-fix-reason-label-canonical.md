# PBI 2026-09-12-34 — reason-label の canonical 解決を 3 surface 全体に（raw slug 表示実バグ）

- **種別**: 🔧非功能追加（fix・表示バグ解消）
- **優先度**: 2 位 / RICE **32.0**（R10 × I2 × C80% / E0.5人日）
- **出典**: round 13 診断 候補 34・サブエージェント探索 + 直接検証

## 背景（なぜ）

round 12 PBI 31 で `reasonLabel.ts` を新設したが、3 site のうち 2 site（recordingHandlers.ts:151・recordSession.ts:231-234）が `legacyReasonMessageKey` のみを解決する浅い側を利用し続けている。locale は canonical `privacyStatus_cacheControl/setCookie/authorization/unknown` を出荷（en:1167-1176）している一方、legacy family は `privatePageReason_authorization` の 1 件のみ（en:1199）→ **cache-control / set-cookie の通知と popup エラー文が raw slug（"cache-control"）のまま localized label にならない**。visitReporter のみ canonical first。

## スコープ

- recordingHandlers / recordSession を `resolveReasonLabel(reason, getMessage)` adapter に統一
- `legacyReasonMessageKey` は visitReporter の注入 seam 参加者として維持（統一署名への移行は注入側の型変更を伴うため本 PBI 外）
- 既存テストの raw-key 文字列 assert を canonical label に反転

## 受け入れ基準（BDD）

### シナリオ 1: cache-control が localized label になる（ハッピーパス）
```gherkin
Given reason が 'cache-control'
When ラベルを解決する
then privacyStatus_cacheControl の文言が返る（raw slug ではない）
```

### シナリオ 2: 未知 reason は raw 文字列にフォールバック（境界）
```gherkin
Given reason が 'unknown-reason-x'
When ラベルを解決する
then canonical/legacy とも miss し raw 文字列が返る
```

## DoD

- [x] 2 site を resolveReasonLabel に統一
- [x] label matrix テスト新設（canonical hit / legacy fallback / raw fallback）
- [x] 対象テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟡軽微（通知・popup エラー文が raw slug から localized label に変わる = 表示バグの解消）

## 実装メモ（2026-09-12）

- recordingHandlers / recordSession を `resolveReasonLabel(reason, getMessage)` adapter に統一。visitReporter は既に canonical first（注入 seam 経由）
- recordOrchestrator テストの期待値を canonical key に更新（PBI 31 で残った raw legacy key assert の反転）
- 検証: popup/background/content 3,637 tests green・type-check green・lint 0 errors
