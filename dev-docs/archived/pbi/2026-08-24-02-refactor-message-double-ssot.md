# PBI-02: メッセージ検証の二重SSOT解消

優先度: 2位 / RICE 21.3 (Reach 8 × Impact 2 × Conf 80% / Effort 0.6w)
種別: refactor
依存: なし
ファイル触接: `src/background/messageTypes.ts:236-247`, `src/background/handlers/MessageRouter.ts:192-245`, `src/background/handlers/messageHandler.ts:1-113`
Effort: 0.6w (Medium)

## 背景

`CONTENT_SCRIPT_ONLY_TYPES = ['VALID_VISIT','CHECK_DOMAIN']`（2要素）がmessageHandlerでsender検証に使われ、`CONTENT_SCRIPT_ALLOWED_TYPES = ['VALID_VISIT','CONTENT_CLEANSING_EXECUTED','CHECK_DOMAIN','PING']`（4要素）がMessageRouterのtrustLevels SSOTとして使われる。2配列が独立定義でdriftリスク（MessageRouter導入時に4要素に拡張した際にONLY側の更新漏れが残留）。さらにmessageHandlerは`VALID_MESSAGE_TYPES.includes` + `NO_PAYLOAD_TYPES` + protocolVersion + trust二重チェックを独自に持ち、MessageRouterも同等のtrust/validatorチェックを持つため検証責務が2層に分散。shallow moduleの典型で、変更時に2箇所同期が必要。

## 目的

`CONTENT_SCRIPT_ALLOWED_TYPES`を唯一のSSOTとし、messageHandlerを`restore + migrate + router.dispatch`の薄い層に縮小する。trust policyを1 seamに集中させ二重チェックの矛盾を検出可能にする。

## なぜなぜ分析

1. なぜ二重SSOTか → MessageRouter導入時にALLOW 4要素を新設したがmessageHandlerのONLY 2要素を削除せず残留したため
2. なぜ削除せず残留したか → content-script許可の変更が2配列で完結する認識がなく、後方互換として両方残す方が安全に見えたため
3. なぜ安全に見えたか → `grep CONTENT_SCRIPT`で2箇所ヒットするが、どちらが正かのドキュメントがなく、片方消すと他方でfailする不安があったため
4. なぜドキュメントがなかったか → MessageRouter導入PBIでSSOT化の意図はあったが、移行完了のDoDに「旧定数削除」が明記されていなかったため
5. なぜDoDに明記されていなかったか → 段階移行を優先し、テストが両方通ることをもって完了とみなしたため

→ 解: ALLOWEDをSSOTにし、ONLYは`as const satisfies`で派生または削除。messageHandlerの外側検証をMessageRouterまたはvalidators.tsに集約し、messageHandlerはthinに。MessageHandler型の`any`も段階的に狭める。

## 受け入れ基準 (BDD)

### Scenario 1: SSOT一本化（ハッピーパス）

- **Given** `CONTENT_SCRIPT_ALLOWED_TYPES`が4要素（VALID_VISIT, CONTENT_CLEANSING_EXECUTED, CHECK_DOMAIN, PING）で定義されている
- **When** 新しいcontent-script許可タイプ（例: `NEW_TYPE`）を追加する
- **Then** 変更箇所は`messageTypes.ts`の1配列のみで、MessageRouterとmessageHandlerの両方に自動反映される
- **And** `CONTENT_SCRIPT_ONLY_TYPES`は存在しないか、`ALLOWED`からの派生として型レベルで保証される

### Scenario 2: 不正senderの拒否（セキュリティ）

- **Given** content script以外（例: popupや外部extension）から`VALID_VISIT`メッセージが送信された
- **When** `MessageRouter.dispatch`が呼ばれる
- **Then** trust checkで拒否され、`ServiceError`または適切なエラーレスポンスが返される
- **And** messageHandlerの外側チェックとMessageRouterの内側チェックが二重に拒否するのではなく、単一seamで一貫して拒否される

### Scenario 3: 無効ペイロードの検証

- **Given** `VALID_VISIT`に不正なpayload（例: `content`が欠落）が含まれる
- **When** dispatchが実行される
- **Then** validatorが検出し、エラーレスポンスが返される
- **And** `NO_PAYLOAD_TYPES`の判定も単一箇所で完結する

### Scenario 4: 既存テストの維持

- **Given** 既存のMessageRouter/messageHandlerテストが存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSし、19 handlerのtrust levelが正しく検証される

## DoD

- [ ] `CONTENT_SCRIPT_ALLOWED_TYPES`が唯一のSSOTとして定義されている
- [ ] `CONTENT_SCRIPT_ONLY_TYPES`は削除またはALLOWEDからの派生として型保証されている
- [ ] `messageHandler.ts`が`restore + migrate + router.dispatch`の薄い層に縮小されている（重複trust check削除）
- [ ] `VALID_MESSAGE_TYPES`の dead branch（GET_CONTENT等）が整理されている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（MessageRouter 5件 + messageHandler関連）
- [ ] 新規テストでSSOT一本化（ALLOWED変更が両層に反映）が検証されている

## 技術メモ

- `src/background/messageTypes.ts:236`の`CONTENT_SCRIPT_ONLY_TYPES`と`247`の`CONTENT_SCRIPT_ALLOWED_TYPES`を比較し、差分（CONTENT_CLEANSING_EXECUTED, PING）が意図的かを確認。前者はMessageRouter導入前の旧定義。
- `src/background/handlers/messageHandler.ts`の外側検証（line 30-80付近）を精査し、MessageRouterに移譲可能なもの（protocolVersion, NO_PAYLOAD）を洗い出す。
- `MessageHandler`型の`any`（line 71-72）は今回スコープ外でも良いが、可能なら`ExtensionMessage`に狭める。
- 参考: `dev-docs/ARCH_REVIEW.md` Finding #3のBefore/After図。
