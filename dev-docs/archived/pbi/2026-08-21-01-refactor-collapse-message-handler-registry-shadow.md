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
- [x] `src/background/handlers/MessageHandlerRegistry.ts` と `createMessageHandlerRegistry.ts` が削除されている（`git log --diff-filter=D` で確認）
- [x] `src/background/createBackgroundServices.ts` が deps リテラルを1箇所で構築し、`new MessageRouter(deps)` を1回だけ呼ぶ（重複する168–198行の二重リテラルが存在しない）
- [x] `src/background/messageHandler.ts` が `deps.router` 必須の単一 dispatch パス（`registry.dispatch` fallback なし）で動作する
  - **現状**: 98–101行で `if (deps.router)` の条件分岐あり。router 優先、fallback として registry.dispatch 残存 → 解消済み
- [x] `MessageRouter` の `handlers` / `trustLevels` / `validators` が private のまま dispatch seam 越しにテストされる（`as unknown as { handlers: Map }` の cast が存在しない）
  - **解消方法**: `getHandler` / `getTrustLevel` / `getRegisteredTypes` の observable accessor を追加し cast を全廃
- [x] 既存の `MessageRouter.test.ts` / `MessageHandlerRegistry.validators.test.ts` 相当のテストが `MessageRouter` seam 越しにパスする（19 type × trust × validator の網羅は維持）
  - **移行結果**: validators テストは `MessageRouter.validators.test.ts` に移行、trust 網羅は `senderTrustCoverage.test.ts` が accessor 経由で維持。旧クラス専用テスト2ファイルは削除
- [x] `npm run type-check` と `npm run validate` がパスする

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
2pt（要チームでの見積もり）— 以下の複雑さを考慮
- messageHandler.ts の 2分岐（registry / router）の片方化（98–101行の条件分岐削除）
- createBackgroundServices.ts の 2箇所の deps リテラルの統合（168行 + 198行）
- テストの二重化解消（MessageRouter.test.ts + MessageHandlerRegistry.validators.test.ts の統合）
- 型チェック対応（MessageHandlerDeps の registry 削除に伴う import 修正）
- **注**: INDEX.md 記載の見積もり 2pt を採用

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
1. `MessageRouter.test.ts` に「19 handler が router.handlers に登録されている」契約テストを追加（RED で失敗しないことを確認 — 既存のテストで代替可能か確認）
2. `createMessageHandlerRegistry` の呼び出しを `createBackgroundServices.ts` から削除し、deps リテラルを共通化
   - 現状: createBackgroundServices.ts の 168行と 198行に別々の deps リテラル構築あり
   - 目標: 1箇所で `const deps = { ... } as MessageHandlerRegistryDeps` を定義し、createMessageRouter のみ呼び出し
3. `messageHandler.ts` の `MessageHandlerDeps` から `registry` を削除し `router: MessageRouter` を必須化
   - 現状: 32–39行で registry と router (optional) が混在
   - 削除後: router 必須、fallback 分岐（98–101行）を削除
4. `MessageHandlerRegistry.ts` / `createMessageHandlerRegistry.ts` を削除（`git rm`）
5. 旧 registry を import していたテストの import を `MessageRouter` に置換し、`npm run validate` で確認
6. `dev-docs/ADR/2026-07-26-domain-filter-layer-map.md` など registry に言及する ADR があれば追記で deprecated 経路の削除を記録

### 落とし穴
- `createMessageHandler()` は現在 deps.registry と deps.router の両方をサポート。router 必須化時にテスト側が deps の構築を更新する必要
  - 現状: messageHandler.ts:32–39 で `MessageHandlerDeps` に registry と router (optional) が両方存在
  - 削除後: registry を削除し router 必須化 → テストで `createMessageHandler({ router, tabCache, ... })` に置換が必要
- `handlers` / `trustLevels` / `validators` が private なので `as unknown as` で無理に読むテストが残っていると削除後にコンパイルエラーになる — `getHandlerCount()` や `dispatch` の observable な振る舞いで検証する形に書き換える

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（MessageRouter dispatch 経路の分岐カバレッジ）
- [x] コードレビュー完了
- [x] リファクタリング完了（cast 削除・重複リテラル解消）
- [x] ドキュメント更新済み（ADR 追記 or LAYERS.md の handler 記述を MessageRouter に更新）

---

## 妥当性確認結果（2026-08-22）

### ✅ 確認済み事項
1. **MessageHandlerRegistry の残存**: ファイルは現在も存在（MessageHandlerRegistry.ts, createMessageHandlerRegistry.ts）
2. **二重構築の実態**: createBackgroundServices.ts で createMessageHandlerRegistry（168行）と createMessageRouter（198行）が別々に呼ばれている
3. **MessageRouter の状態**: 既に 19 handler を内部で登録済み（MessageRouter.ts:79–）
4. **messageHandler.ts の分岐**: 現在 98–101行で router 優先、registry fallback の条件分岐が存在（削除対象）
5. **参照数**: grep -rn で MessageHandlerRegistry への参照が 23件残存（テスト含む）

### ⚠️ 注意事項
- **deps リテラルの重複**: createBackgroundServices.ts の 168行と 198行に別々の deps リテラル構築が存在 → 統合時に漏れやすい
- **テスト二重化**: MessageRouter.test.ts と MessageHandlerRegistry.validators.test.ts の両方が存在 → 統合後の削除判定が必要
- **型推論**: MessageHandlerDeps の registry 削除時に「router は必須（optional ではない）」の型更新が必須
- **見積もり**: 実装手順 5ステップの各ステップで type-check が必須（Pick 型の抽出ロジックが壊れやすい）

### 📝 PBI の精度確認
- **ユーザーストーリー**: 妥当（二重構築・二重 dispatch パスが実在を確認）
- **受け入れ基準**: 妥当（ただし現状のコード位置が 168–226行ではなく 168–198行に修正）
- **テスト戦略**: 妥当（E2E / 統合 / 単体の 3層は適切）
- **落とし穴**: 実装時に「deps.router 優先化」の分岐削除が漏れやすい点を強調済み
