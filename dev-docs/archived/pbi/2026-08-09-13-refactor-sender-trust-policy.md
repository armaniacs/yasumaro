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

- [x] 信頼レベルの型を定義する（`senderTrust.ts`）
- [x] `MessageHandlerRegistry.register` を第3引数必須に変更する
- [x] `dispatch` で信頼レベルを判定してから handler を呼ぶ
- [x] 19箇所の `registry.register` に信頼レベルを付与する
- [x] 各信頼レベルの判定に対するテストを追加する（11件）
- [x] `REFRESH_LOCAL_MARKDOWN_SCHEDULER` を content script から
      叩けてよいかを検討し、結論をコメントで残す
- [ ] ~~handler 側の個別チェックを削除する~~ → **意図的に残す**（下記）

## 実装結果

### 送信元の実地調査

信頼レベルを機械的に付けず、**全メッセージ型の実際の送信元を grep で確認**した。

| メッセージ型 | 実際の送信元 | 付与した信頼レベル |
|---|---|---|
| `VALID_VISIT` | content script | content-script-allowed |
| `CHECK_DOMAIN` | `content/loader.ts` | content-script-allowed |
| `CONTENT_CLEANSING_EXECUTED` | `utils/contentExtractor/index.ts`（ページ内実行） | content-script-allowed |
| `PING` | `dashboard/historyUtils.ts` ほか。副作用なしの死活確認 | content-script-allowed |
| `LOG_FORWARD` | **offscreen document** | extension-only |
| `CONSENT_STATE_CHANGED` | `popup/privacyConsentController.ts` | extension-only |
| `GENERATE_REVIEW_SUMMARY` | `dashboard/reviewSummaryHandler.ts` | extension-only |
| `REFRESH_LOCAL_MARKDOWN_SCHEDULER` | `dashboard/dashboard.ts` | **extension-only（強化）** |
| その他11型 | popup / dashboard | extension-only |

`LOG_FORWARD` は offscreen document からの送信だが、offscreen は
`chrome-extension://` URL を持ち `sender.tab` が無いため `extension-only` で通る。

### 実際に強化された点

`REFRESH_LOCAL_MARKDOWN_SCHEDULER` は個別チェックが無く、
content script から**エクスポートスケジューラを再起動できる状態**だった。
送信元は dashboard のみと確認できたため `extension-only` にした。

`CONSENT_STATE_CHANGED` / `GENERATE_REVIEW_SUMMARY` / `LOG_FORWARD` の3件は
素の `sender.id` チェック（content script は通過する）のみだったが、
registry 側で content script を弾くようになった。
特に `GENERATE_REVIEW_SUMMARY` は**課金対象のAI呼び出しを起動する**ため意味が大きい。

### handler 側の個別チェックを残した理由

PBI に「移行時は二重チェックの状態を経由すると安全」と書いた方針を採用した。
registry 側の判定が全経路で正しく効いていることを E2E まで含めて確認できたが、
個別チェックの削除は**防御を減らす変更**であり、本 PBI の主目的
（ポリシーの集約と既定の安全化）は既に達成している。

削除は独立した PBI で、1型ずつ確認しながら行うのが妥当。

### 追加テスト（11件）

`senderTrust.test.ts` を新規作成。4種類の送信元
（content script / 拡張ページ / offscreen / 外部拡張）を定義し、
各信頼レベルとの組み合わせを検証している。

- extension-only が content script を拒否し、拡張ページと offscreen を許可すること
- content-script-allowed が content script を許可すること
- 外部拡張は信頼レベルによらず拒否されること
- registry の dispatch が **handler を呼ぶ前に**拒否すること
- **content script がエクスポートスケジューラを起動できないこと**

### テストの実効性検証

`dispatch` の判定を無効化したところ、**2件が赤**
（`does not invoke an extension-only handler for a content script` と
`blocks a content script from restarting the export scheduler`）。復元後に緑。

### 検証結果

- `npm run validate`: **7546件 通過**（412ファイル、18 skip）
- `npm run build`: 成功
- `npm run test:e2e`: **185件 通過**、7 skip、失敗0
  （content script 記録・SW オーケストレーションを含む）

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
