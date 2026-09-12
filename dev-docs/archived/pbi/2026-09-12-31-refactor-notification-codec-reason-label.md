# PBI 2026-09-12-31 — NotificationCodec + ReasonLabel（codec 3 箇所・ラベル 3 スペリング統合）

- **種別**: 🔧非機能追加（refactor + latent bug 解消）
- **優先度**: 7 位 / RICE **6.4**（R8 × I1 × C80% / E1.0人日）
- **出典**: round 12 診断 候補 31・サブエージェント探索

## 背景（なぜ）

wire codec（prefix `privacy-confirm-` + url-safe base64 + HMAC）が 3 call site で再派生: `urlNotificationHandlers.ts:21-65,72-134`、`notificationHelper.ts:4`、`notificationHandlers.ts:46,59,64`。reason ラベルは 2 i18n family 上に 3 スペリング: `recordingHandlers.ts:143-149`、`visitReporter.ts:193-200`、`popup/recordCurrentPage/recordSession.ts:228` — いずれも `.replace('-','')`（初回のみ置換）がコピペされ、multi-hyphen reason で i18n lookup が破綻する latent bug。

## スコープ

- `NotificationCodec` module 新設: `encode(url) / decode(id) / isOurs(id)` — prefix と上限（MAX_URL_LENGTH / MAX_ENCODED_LENGTH）は implementation
- `ReasonLabel` module 新設: `reason → messageKey → label` の単一テーブル（`reasonToStatusCode` / `statusCodeToMessageKey` / `privatePageReason_*` fallback を統一・replace は replaceAll）
- 3 label site + codec call site を委譲
- 振る舞い: 現行の key・文言は不変

## 受け入れ基準（BDD）

### シナリオ 1: codec round-trip が 1 箇所で pin される（ハッピーパス）
```gherkin
Given 任意の URL
When encode → decode を行う
then 元の URL が復元され、改変 id は拒否される（1 テーブルのテスト）
```

### シナリオ 2: multi-hyphen reason も解決される（境界）
```gherkin
Given reason が 'cache-control-extended' のような multi-hyphen 値
When ラベルを解決する
then replaceAll により正しい message key が生成される
```

## DoD

- [x] 両 module 新設・call site 委譲・replaceAll 化
- [x] codec round-trip/tamper テスト + label matrix テスト新設
- [x] 対象テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（現行 key・文言不変）

## 実装メモ（2026-09-12）

- **主張の訂正（直接検証）**: wire codec は既に単一 module（urlNotificationHandlers.ts の encode/decode）に集約されており、3 call site は「再派生」ではなく共有関数の import — codec 部分は既に SSOT だった。実在した重複は reason ラベルの 3 スペリングのみ
- `reasonLabel.ts` 新設: `reasonToMessageKeys(reason)`（canonical `privacyStatus_*` + legacy `privatePageReason_*` の両 key を返す）+ `resolveReasonLabel`（canonical → legacy → raw の順で解決）+ `legacyReasonMessageKey`（replaceAll で multi-hyphen 対応）
- 3 label site（recordingHandlers / visitReporter / recordSession）を委譲 — `.replace('-','')` 初回のみ置換の latent bug 解消
- 検証: content + background + popup 3,636 tests green・type-check green・lint 0 errors
