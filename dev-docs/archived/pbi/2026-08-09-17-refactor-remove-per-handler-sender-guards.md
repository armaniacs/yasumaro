# PBI: handler 側の個別認可チェックを削除する

**作成日**: 2026-08-09
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🔴あり（**防御を減らす変更**。認可経路の回帰は重大）
**種別**: ♻️リファクタリング（refactor / security）

---

## 背景

[2026-08-09-13](2026-08-09-13-refactor-sender-trust-policy.md) で
`MessageHandlerRegistry` に信頼レベルを導入し、dispatch 前に認可を判定するようにした。

そのとき handler 側の個別チェックは**二重防御として意図的に残した**。
移行直後に防御を減らすのは危険であり、registry 側が全経路で正しく効くことを
E2E まで含めて確認した上で、別 PBI で削除する方針としたため。

本 PBI でその削除を行う。

## 現状: 同じ判定が2回走っている

```typescript
// 1. registry が dispatch 前に判定（2026-08-09-13 で追加）
const decision = checkSenderTrust(sender, trust, type, this.runtimeId);
if (!decision.allowed) { sendResponse({ success:false, error:decision.error }); return false; }

// 2. handler 内でも同じ判定（従来からある）
if (rejectContentScriptSender(sender, sendResponse, 'FETCH_URL')) return;
```

### 削除対象

| 方言 | 箇所 | 対象 |
|---|---|---|
| `rejectContentScriptSender(...)` | 9 | FETCH_URL / MANUAL_RECORD / SAVE_RECORD / TEST_CONNECTIONS / TEST_OBSIDIAN / TEST_AI / GET_PRIVACY_CACHE / ACTIVITY_UPDATE / SESSION_LOCK_REQUEST |
| 素の `sender.id !== chrome.runtime.id` | 3 | CONSENT_STATE_CHANGED / LOG_FORWARD / GENERATE_REVIEW_SUMMARY |
| インライン複製 | 1 | `service-worker.ts` の DASHBOARD_SQLITE |
| 関数本体 | 1 | `rejectContentScriptSender` 自体 |

`VALID_VISIT` の `if (!sender.tab)` は**削除しない**。
これは認可ではなく「tab 情報が必要」という業務要件であり、
後続で `sender.tab.url` / `sender.tab.id` を参照するための null チェックを兼ねる。

## リスクと対策

**本 PBI は防御を減らす変更である。** 以下を必須とする。

1. registry の信頼レベルが**現在の個別チェックと同じ判定**をしていることを、
   削除前に型・テスト両面で確認する
2. 削除は方言ごとに段階的に行い、各段階で全テスト＋E2Eを通す
3. 「registry を経由しない呼び出し経路が存在しない」ことを確認する
   （handler を直接 import して呼ぶテスト・コードがあれば、そこは防御が消える）

### 重要: handler を直接呼ぶテストの扱い

多くの handler テストは `createXxxHandler(deps)` を直接呼んでおり、
**registry を経由しない**。個別チェックを削除すると、
これらのテストが検証していた「content script 拒否」は
handler 単体では成立しなくなる。

これは仕様として正しい（認可は registry の責務になった）が、
**該当テストを削除するのではなく registry 経由の検証に移す**こと。
単に消すと認可のテストカバレッジが失われる。

## `sqlite-security-integrity.test.ts` への影響

このテストは Red Team 指摘に対応するもので、
**`service-worker.ts` のソーステキストに `sender.tab` ガードが存在すること**を
文字列照合で検証している（27-61行）。

インライン複製を削除すると**このテストは落ちる**。

ただしテストが本来守りたい不変条件は
「content script が DASHBOARD_SQLITE 経由で SQLite 操作に到達できない」であり、
ガードが `service-worker.ts` にあることではない。

→ **ソーステキスト照合から、振る舞いの検証に書き換える。**
   （registry 経由で content script sender を dispatch し、拒否されることを確認する）

これは「テストが落ちたから消す」のではなく、
**同じ不変条件をより正確に検証する形に置き換える**ものである。

## 作業内容

- [x] registry 経由の認可テストが**全19型**を網羅しているか確認し、不足を補う
      （起票時「13型」と書いたが実際は19型）
- [x] `rejectContentScriptSender` の9箇所を削除する
- [x] 素の `sender.id` チェック3箇所を削除する
- [x] `service-worker.ts` のインライン複製を削除する
- [x] `rejectContentScriptSender` 関数本体を削除する
- [x] handler 単体テストのうち認可を検証していたものを registry 経由に移す
- [x] `sqlite-security-integrity.test.ts` を振る舞い検証に書き換える

## 実装結果

### 削除前に網羅テストを用意した

防御を減らす変更のため、**先に** `senderTrustCoverage.test.ts`（59件）を作成した。

このテストは `service-worker.ts` から登録表を**正規表現で抽出**し、
期待する信頼レベル表と突き合わせる。さらに全19型 × 3種類の送信元
（content script / 拡張ページ / 外部拡張）の判定を検証する。

これにより、以後の変更で信頼レベルが緩んだ場合に必ず検知される。

### 削除内容

| 対象 | 箇所 |
|---|---|
| `rejectContentScriptSender(...)` 呼び出し | 9 |
| 素の `sender.id !== chrome.runtime.id` | 3 |
| `service-worker.ts` のインライン複製 | 1 |
| `rejectContentScriptSender` 関数本体 | 1 |
| `senderGuard.test.ts`（削除した関数の単体テスト） | 1ファイル |

VULN-004/009/018/019/020 のコメントは**残し**、
「registry の trust level で強制される」ことを追記した。
なぜその型が拡張ページ専用なのかという知識は失われていない。

`VALID_VISIT` の `if (!sender.tab)` は**削除していない**。
これは認可ではなく、後続で `sender.tab.url` / `sender.tab.id` を
参照するための業務上の null チェックであるため。

### 直接呼び出しテスト6件の移行（削除ではない）

起票時に予測したとおり、handler を直接呼ぶテストが6件落ちた。
**削除せず registry 経由の検証に移した**。

| ファイル | 対応 |
|---|---|
| `messageHandlers-recordSecurity.test.ts` | MANUAL_RECORD / SAVE_RECORD の2件を registry dispatch に変更。拒否メッセージの検証も追加 |
| `consentStateChanged.test.ts` | 外部拡張・sender id 欠落の2件を registry 経由に変更。**content script 拒否のテストを新規追加** |
| `sqlite-security-integrity.test.ts` | 下記 |

### `sqlite-security-integrity.test.ts` の書き換え

Red Team 指摘に対応するテストで、`service-worker.ts` のソーステキストに
`sender.tab` ガードが存在することを文字列照合していた。

**同じ不変条件をより正確に検証する形に置き換えた**：

- 全20 subtype について content script が拒否されることを実際に dispatch して確認
- `dispatch` が `false` を返し handler が呼ばれないこと（＝SQLite操作が始まらないこと）
- dashboard からは通ること
- DASHBOARD_SQLITE が `extension-only` で登録されていること

ソーステキスト照合と違い、**ガードがどこにあっても成立する**検証になった。

### テストの実効性検証

`DASHBOARD_SQLITE` の登録を `content-script-allowed` に改竄したところ、
**2件が赤**：

- `registers DASHBOARD_SQLITE as extension-only`（security-integrity）
- `assigns each type the trust level this test documents`（coverage）

復元後に緑。認可が緩んだ場合に確実に検知されることを確認した。

### 検証結果

- `npm run validate`: **7605件 通過**（412ファイル、18 skip）※ 7546 → 7605（+59）
- `npm run build`: 成功
- `npm run test:e2e`: **185件 通過**、7 skip、失敗0
- 認可判定が `checkSenderTrust` の1箇所のみに存在することを grep で確認

## 完了条件

- 認可判定が registry の1箇所のみに存在する
- 全13型について「content script が拒否される / 許可される」が
  registry 経由のテストで検証されている
- `npm run validate` と `npm run test:e2e` が通る
- **削除前後で拒否される組み合わせが1つも変わっていない**

## 参照

- 前提: [2026-08-09-13](2026-08-09-13-refactor-sender-trust-policy.md)
