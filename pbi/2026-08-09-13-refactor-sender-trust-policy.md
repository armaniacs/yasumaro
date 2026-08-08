# PBI: 送信元認可ポリシーを registry に集約する

**作成日**: 2026-08-09
**優先度**: 中
**見積もり**: 🟡中（2〜3pt目安）
**副作用**: 🔴あり（全メッセージ型の認可経路を変更。E2E への影響を要確認）
**種別**: ♻️リファクタリング（refactor / security hardening）

---

## 背景

アーキテクチャレビュー（2026-08-09、候補4）で、
「誰がこのメッセージを送ってよいか」というポリシーが
**19 handler に4方言で散在**していることが判明した。

### registry のゲートは content script を止めない

```typescript
// src/background/handlers/MessageHandlerRegistry.ts:30-34
if (this.runtimeId !== undefined && sender.id !== this.runtimeId) {
  sendResponse({ success: false, error: 'Invalid sender' });
  return false;
}
```

content script は拡張機能自身の一部なので `sender.id === chrome.runtime.id` を
**満たしてしまう**。これはコード自身のコメントが明記している事実である：

```typescript
// src/background/handlers/messageHandlers.ts:51-53
// Content scripts run inside a tab on a web page and satisfy the registry's
// `sender.id === chrome.runtime.id` check, so they can reach handlers that are
// meant for extension pages / offscreen only.
```

### 結果: 各 handler が個別に防御し、4方言に分裂した

| 方言 | 実装 | 対象 |
|---|---|---|
| 1 | `rejectContentScriptSender(...)` | 9 handler |
| 2 | 素の `sender.id !== chrome.runtime.id` | `CONSENT_STATE_CHANGED`, `LOG_FORWARD`, `GENERATE_REVIEW_SUMMARY` |
| 3 | `if (!sender.tab)` の**反転**（VALID_VISIT は tab を要求） | 1 handler |
| 4 | guard 本体を**インライン複製** | `service-worker.ts:432-439`（DASHBOARD_SQLITE） |

さらに以下の4型には**個別チェックが無い**：
`CHECK_DOMAIN` / `CONTENT_CLEANSING_EXECUTED` /
`REFRESH_LOCAL_MARKDOWN_SCHEDULER` / `PING`

### これは「後追いで塞いだ跡」である

VULN-004 / 009 / 018 / 019 / 020 のコメントが handler ごとに点在している。
1件ずつ発見しては塞ぐ形になっており、**ポリシーが置かれる場所が間違っている**症状。

現在の既定は暗黙に「content script 許可」であり、
新しい handler を追加した人が明示的に塞がない限り**穴が開く**。

## 深刻度についての正直な評価

無防備な4型のうち：

- `PING` — 実害はほぼ無い
- `CHECK_DOMAIN` — ドメイン可否を返すだけ。情報漏洩は限定的
- `CONTENT_CLEANSING_EXECUTED` — バッジ更新のみ
- `REFRESH_LOCAL_MARKDOWN_SCHEDULER` — スケジューラを起動する。**要検討**

**緊急の脆弱性ではなく、構造の問題**として扱う。
本 PBI の主目的は「新しい handler が既定で安全側になる」ことである。

## 方針

`register()` に**信頼レベルを必須引数**として要求し、dispatch 前に registry が強制する。

```
Before: register('PING', handler)            → 誰でも通る（暗黙）
After:  register('PING', handler, <信頼レベル>) → 書かないとコンパイルが通らない
```

信頼レベルの語彙は実装時に確定させるが、少なくとも以下の区別が必要：

- 拡張ページ（dashboard / popup / offscreen）のみ
- content script も可（`VALID_VISIT` 等、tab からの通知が本質のもの）

## 作業内容

- [ ] 信頼レベルの型を定義する
- [ ] `MessageHandlerRegistry.register` を第3引数必須に変更する
- [ ] `dispatch` で信頼レベルを判定してから handler を呼ぶ
- [ ] 19箇所の `registry.register` に信頼レベルを付与する
      （**現在の挙動を変えないこと**。無防備な4型は現状維持で明示する）
- [ ] handler 側の個別チェック（方言1〜4）を削除する
- [ ] `service-worker.ts:432-439` のインライン複製を削除する
- [ ] 各信頼レベルの判定に対するテストを追加する
- [ ] `REFRESH_LOCAL_MARKDOWN_SCHEDULER` を content script から
      叩けてよいかを検討し、結論をコメントで残す

## 完了条件

- 信頼レベルを指定せずに `register` するとコンパイルエラーになる
- 既存の拒否挙動がすべて維持されている（E2E含む）
- `npm run validate` と `npm run test:e2e` が通る

## 注意

**認可の緩和を伴わないこと。** 本 PBI は「同じ判定を1箇所に集める」作業であり、
現在拒否されているものが通るようになってはならない。

移行時は handler 側のチェックを削除する前に registry 側を先に有効化し、
二重チェックの状態を経由すると安全。

## 参照

- アーキテクチャレビュー 2026-08-09 候補4
- ADR 抵触なし
