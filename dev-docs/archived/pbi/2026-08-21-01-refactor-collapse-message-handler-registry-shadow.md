# PBI: MessageHandlerRegistry shadow の collapse — MessageRouter 1 seam に集約

## ユーザーストーリー
開発者として、19 handler の dispatch を `MessageRouter.dispatch(msg, sender)` の1 seam に集約したい、なぜなら二重構築と二重 dispatch パスがバグの温床（trust / validator の抜け漏れ）とテストの二重化を生んでいるから

## 優先度
- 順位: 1 / 5
- RICEスコア: 1200（Reach=500 / Impact=3 / Confidence=80% / Effort=1人週）
- 根拠: 全メッセージ経路に影響（VALID_VISIT / DASHBOARD_SQLITE など19種）。Impact 3（unsafe cast 削除・二重構築削除・dispatch 一本化）。Confidence 80%（実コード確認済み、テスト二重化の解消効果は確実）。Effort 1週（5ファイル削除・更新、テスト移行）。Top recommendation と一致。依存なし。

## ビジネス価値
- 新しい message type 追加時に trust / validator の紐付けを1箇所で完結させ、権限抜け（例: VALID_VISIT が content-script-allowed なのに DASHBOARD_SQLITE が extension-only という差異）の見落としを防ぐ
- `createBackgroundServices` の同一 deps リテラル二重化を解消し、composition root の可読性と AI-navigability を向上
- 測定: `createMessageHandlerRegistry` 参照が0件、`MessageHandlerRegistry` 参照がテストの `MessageRouter` seam 経由のみになること

## BDD受け入れシナリオ

```gherkin
Scenario: 単一 dispatch seam で全19 type を処理する
  Given Service Worker が MessageRouter のみで初期化されている
  When 各 message type（VALID_VISIT / FETCH_URL / MANUAL_RECORD / DASHBOARD_SQLITE など19種）を extension-only / content-script-allowed の両 sender で送信する
  Then trust 判定と validator 検証が MessageRouter 内部で一貫して実行され、正しい handler に委譲される

Scenario: 二重構築が解消されている
  Given createBackgroundServices が deps リテラルを1回だけ構築する
  When chrome.runtime.onMessage が任意の ExtensionMessage を受ける
  Then MessageRouter が1回だけ生成され、deprecated factory 経由の二重生成（cast による Map 抽出）が存在しない

Scenario: 旧 registry パスが削除されている
  Given MessageHandlerRegistry と createMessageHandlerRegistry が削除されている
  When grep -rn "MessageHandlerRegistry|createMessageHandlerRegistry" src/ --include="*.ts" を実行する
  Then src/background/messageHandler.ts の no-arg createMessageHandler() が router 必須の単一パスで動作し、fallback 分岐が存在しない

Scenario: trust 抜けが1箇所で防がれる
  Given 新しい message type を MessageRouter に追加する（handler + trust + validator を1箇所で登録）
  When その type を content script から送信する（本来 extension-only）
  Then checkSenderTrust により { success:false, error: 'Invalid sender' } が返り handler は呼ばれない

Scenario: エラー時も二重化なしで応答する
  Given DASHBOARD_SQLITE の confirmToken が不正な payload を送信する
  When MessageRouter.dispatch が validator で ValidationError を throw する
  Then sendResponse({ success:false, error }) が1回だけ呼ばれ、未処理 promise rejection が発生しない
```

## 受け入れ基準
- [ ] `src/background/handlers/MessageHandlerRegistry.ts` と `createMessageHandlerRegistry.ts` が削除されている（`git log --diff-filter=D` で確認）
- [ ] `src/background/createBackgroundServices.ts` が deps リテラルを1箇所で構築し、`new MessageRouter(deps)` を1回だけ呼ぶ（重複する 168–226行の二重リテラルが存在しない）
- [ ] `src/background/messageHandler.ts` が `deps.router` 必須の単一 dispatch パス（`registry.dispatch` fallback なし）で動作する
- [ ] `MessageRouter` の `handlers` / `trustLevels` / `validators` が private のまま dispatch seam 越しにテストされる（`as unknown as { handlers: Map }` の cast が存在しない）
- [ ] 既存の `MessageRouter.test.ts` / `MessageHandlerRegistry.validators.test.ts` 相当のテストが `MessageRouter` seam 越しにパスする（19 type × trust × validator の網羅は維持）
- [ ] `npm run type-check` と `npm run validate` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwright で `VALID_VISIT`（content script）→ `DASHBOARD_SQLITE query`（dashboard）の往復が1 seam で成功するシナリオ

### 統合テスト
- MessageRouter.dispatch の trust / validator / handler 統合テスト（19 type × extension-only / content-script-allowed × validator あり/なし）
- createBackgroundServices composition テスト（deps が1回構築され、service-worker が同一 MessageRouter を共有すること）

### 単体テスト
- checkSenderTrust の分岐（sender.id 不一致 / tab なし / content-script-allowed 許可）
- 各 validator の throw → dispatch が { success:false } で捕捉するケース
- handler が async throw した際の catch → sendResponse

## 実装アプローチ
- **Outside-In**: 既存の `MessageRouter.test.ts` を seam として固定 → `MessageHandlerRegistry` 依存テストを `MessageRouter` 越しに書き換え（RED）→ registry 削除（GREEN）→ deps 重複を1箇所に collapse（Refactor）
- **Red-Green-Refactor**: 各ステップで `npm run type-check` を挟む（Pick 型の縮小が壊れていないか確認）

## 見積もり
2pt（要チームでの見積もり）— 5ファイルの削除・更新、テスト移行、type-check 対応

## 技術的考慮事項
- 依存関係: なし（他PBIへの先行依存なし、他PBIは本PBIの完了を待たずに着手可能だが、PBI 02 と同パスで同時レビュー推奨）
- テスタビリティ: MessageRouter は `MessageHandlerRegistryDeps` を受けるが内部で Pick して最小依存に分割済み。テストは `InMemory` deps（hasPrivacyConsent / tabCache / recordingPipeline の fake）で seam 越しに検証
- 非機能要件: Service Worker の multi-tab での sender.id 検証は維持（runtime.id 比較）

## 実装者向け注記

### 現状コードの確認
```bash
# 二重構築の実態
grep -n "createMessageHandlerRegistry\|createMessageRouter\|new MessageRouter" src/background/createBackgroundServices.ts
# shadow factory が MessageRouter を内部生成し cast で抽出している箇所
grep -n "as unknown as" src/background/handlers/createMessageHandlerRegistry.ts
# 二重 dispatch パス
grep -n "deps.router\|registry.dispatch" src/background/messageHandler.ts
# 旧 registry の残存参照数
grep -rn "MessageHandlerRegistry" src/ --include="*.ts" | grep -v "__tests__" | grep -v ".test.ts"
```
未実装ではなく「置換が積層になった」状態。削除が目的であり新規ロジック追加は最小限。

### 実装手順
1. `MessageRouter.test.ts` に「19 handler が router.handlers に登録されている」契約テストを追加（RED で失敗しないことを確認 — 既存の getHandlerCount で代替可能）
2. `createMessageHandlerRegistry` の呼び出しを `createBackgroundServices.ts` から削除し、deps リテラルを共通化（`const deps = { ... } as MessageHandlerRegistryDeps` を1回だけ定義）
3. `messageHandler.ts` の `MessageHandlerDeps` から `registry` を削除し `router: MessageRouter` を必須化、fallback 分岐を削除
4. `MessageHandlerRegistry.ts` / `createMessageHandlerRegistry.ts` を削除（`git rm`）
5. 旧 registry を import していたテストの import を `MessageRouter` に置換し、`npm run validate` で確認
6. `dev-docs/ADR/2026-07-26-domain-filter-layer-map.md` など registry に言及する ADR があれば追記で deprecated 経路の削除を記録

### 落とし穴
- `createMessageHandler()` の no-arg 版（`src/background/messageHandler.ts:165`）がテストから呼ばれている — router 必須化するとテストの `createMessageHandler()` 呼び出しが壊れる。テスト側で `createMessageHandler({ registry, router, ... })` に置換が必要
- `handlers` / `trustLevels` / `validators` が private なので `as unknown as` で無理に読むテストが残っていると削除後にコンパイルエラーになる — `getHandlerCount()` や `dispatch` の observable な振る舞いで検証する形に書き換える

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（MessageRouter dispatch 経路の分岐カバレッジ）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（cast 削除・重複リテラル解消）
- [ ] ドキュメント更新済み（ADR 追記 or LAYERS.md の handler 記述を MessageRouter に更新）
