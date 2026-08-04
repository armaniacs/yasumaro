# PBI: AI_TEST_PROGRESS のメッセージ型契約を一元化し、廃棄を観測可能にする

**作成日**: 2026-08-04
**優先度**: 中（次リリースまでに対応）
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（宣言の一元化とログ追加のみ、挙動は不変）
**種別**: refactor（レビュー指摘: API & Contract Negotiator [Medium]、SRE/Ops [Low]、DX [Low]）

---

## 背景（5 Whys 分析）

Checking Team レビューの以下3指摘を起点とする:

- API & Contract Negotiator [Medium]「AI_TEST_PROGRESS が ExtensionMessage 判別ユニオン / VALID_MESSAGE_TYPES の外に追加され、メッセージ契約の一元管理から外れている」
- SRE/Ops [Low]「進捗push廃棄時の観測手段がない」
- DX [Low]「進捗通知の失敗が完全に握りつぶされ、デバッグ手段がない」

### 5 Whys

- **Why 1**: なぜ AI_TEST_PROGRESS 型が `messageTypes.ts` の単一ソースから外れているのか？
  → 一方向 broadcast として `VALID_MESSAGE_TYPES`（SW が受信する request/response の判別ユニオン）に意図的に含めず、`aiTestProgressNotifier.ts` に分離したため。
- **Why 2**: なぜ外すことが正しい設計判断とされたのか？
  → SW は自らの broadcast を受信しないため、request/response の union に含めると全ハンドラに「受信しない型」の処理が強制される不整合を避けたため。
- **Why 3**: なぜ外した結果が問題になるのか？
  → メッセージ型の「単一ソース」がファイルをまたいで分散し、既存のメッセージ検証テスト（`service-worker-message-validation.test.ts` 等）の対象外になるため、契約のドリフトや型ガードの適用漏れを検知できない。
- **Why 4**: なぜ廃棄が観測不能なのか？
  → fire-and-forget の `chrome.runtime.sendMessage` がレシーバ不在で reject するのを `.catch(() => {})` で黙って握りつぶし、ログ・メトリクスを残さないため。
- **Why 5**: なぜログを残さなかったのか？
  → 「受信側不在は正常系（ダッシュボード未オープン）」とみなし、ノイズ回避を優先したため。しかし廃棄回数・タイミングを観測する手段が無く、進捗が表示されない原因切り分けができない。

### 根本原因
broadcast 型を契約の一元管理（単一ソース）と観測（ログ）の外に置いたまま実装し、「型契約の監視漏れ」と「廃棄の不可視化」の両方を残した。

### 対処
(1) メッセージ型の単一ソースを `messageTypes.ts` に寄せ、broadcast 専用である旨を明文化して一元管理する。(2) notifier の廃棄を `addLog(LogType.DEBUG)` で記録し観測可能にする。

## 受け入れ基準（BDD）

```gherkin
Scenario: broadcast 型が一元管理されている
  Given メッセージ型の単一ソース messageTypes.ts を参照する
  When 全メッセージ型を列挙する
  Then AI_TEST_PROGRESS（broadcast 専用）が一元管理対象として宣言・注記されている

Scenario: 廃棄がログに記録される
  Given レシーバ不在で chrome.runtime.sendMessage が reject する
  When notifier が fire-and-forget を実行する
  Then 例外は伝播せず、廃棄が DEBUG ログとして記録される

Scenario: 正常送信時に不要なログを出さない
  Given レシーバが存在し sendMessage が成功する
  When notifier が fire-and-forget を実行する
  Then DEBUG ログは記録されない（ノイズ回避を維持）
```

## 受け入れ基準
- [ ] `messageTypes.ts` に broadcast 専用型（AI_TEST_PROGRESS）の宣言と「SW 受信対象外」注記が一元化されている
- [ ] `aiTestProgressNotifier.ts` の廃棄が `addLog(LogType.DEBUG)` で記録される
- [ ] 正常系では追加ノイズログが出ない
- [ ] 既存のメッセージ検証・型一貫性テストがパスする

## テスト戦略
- 単体: `src/background/__tests__/aiTestProgressNotifier.test.ts` を拡張し「reject 時に DEBUG ログが記録される」「成功時にログが出ない」を検証
- 既存の reject/sync-throw swallow テストを維持

## 実装アプローチ
- **Red-Green-Refactor**: テスト拡張 → notifier にログ追加 → グリーン化
- `messageTypes.ts` への一元化は型宣言とコメントの移動（挙動変更なし）

## Definition of Done
- [ ] 型契約の一元管理と廃棄ログが実装済み
- [ ] 対応テストが追加され全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- レポート: `plans/2026-08-04-1950-review-v6.7.12-ai-test-progress.md`（API & Contract Negotiator Medium、SRE/Ops Low、DX Low）
- 対象コード: `src/background/aiTestProgressNotifier.ts`, `src/background/messageTypes.ts`
