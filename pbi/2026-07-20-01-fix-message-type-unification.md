# PBI: メッセージング型定義のSSOT化・sender.id検証・Pipeline重複解消

元指摘: Checking Team (High: Maintainability Guardian, Medium: System Architect, API & Contract Negotiator, Blue Team Leader, Maintainability Guardian)

## 実装状況（調査日: 2026-07-20、状態: 🔶 部分実装）

コードベース調査により、以下を確認した。

| 受け入れ基準 | 状態 | 証拠 |
|------------|:----:|------|
| `createRecordingPipeline(deps)` ファクトリ | ✅ 完了 | `src/background/pipeline/RecordingPipeline.ts:49` 定義、`recordingLogic.ts:400` が利用、`as any` なし |
| sender.id 検証（個別ハンドラ） | 🟡 部分 | `createConsentStateChangedHandler` (`handlers/messageHandlers.ts:543`) のみに存在。`MessageHandlerRegistry` での一括検証は未実装 |
| `messaging/types.ts` の `ServiceWorkerRequest` 独立定義削除 → `import type { ExtensionMessage }` | ❌ 未着手 | `ServiceWorkerRequest` は依然として独立定義（14種）。`ExtensionMessage` (`background/messageTypes.ts:133`) は18種（PING/REFRESH_LOCAL_MARKDOWN_SCHEDULER/CONSENT_STATE_CHANGED/DASHBOARD_SQLITE を含む）で乖離が継続 |
| `isServiceWorkerRequest` が全18種をカバー | ❌ 未着手 | `messaging/types.ts:220` の `validTypes` は14種のまま（不足4種未追加） |
| `sendServiceWorkerMessage`/`sendFromPopup` の型引数を `ExtensionMessage['type']` に | ❌ 未着手 | `messaging/types.ts:332,358` は `ServiceWorkerRequest['type']` を使用したまま |

**残作業**: `ServiceWorkerRequest` を `ExtensionMessage` の再エクスポート（または `import type`）に置換し、`isServiceWorkerRequest` の validTypes を18種へ拡張、`MessageHandlerRegistry` に sender.id 一括検証を追加。既存テスト `message-types-consistency.test.ts` / `messaging-types-uniformity.test.ts` は `ServiceWorkerRequest` に依存しているため、置換時に合わせて更新が必要。

## ユーザーストーリー
開発チームとして、`messageTypes.ts` と `messaging/types.ts` に重複するメッセージ型定義を単一情報源に統一し、全メッセージハンドラに sender.id 検証を追加し、重複する RecordingPipeline 構築コードをファクトリ関数に置き換えたい、なぜなら (1) 型の二重管理は新メッセージ種別追加時に修正漏れを誘発し、(2) sender.id 検証の欠如は content script が不正ページに乗っ取られた場合の攻撃経路となり、(3) パイプライン構築のコード重複はコンストラクタ変更時の修正漏れリスクがあるから

## ビジネス価値
- 不正な sender からのメッセージ処理を防止（防御的セキュリティ）
- メッセージ種別追加時のバグ（型不整合・ハンドラ未登録）をコンパイルエラーで検出可能に
- パイプライン構築ロジックの重複排除による保守性向上

## 前提・制約
- Content Script の ESM 未対応制約により `loader.ts` の `CURRENT_PROTOCOL_VERSION` 定数は別途維持する（コメントで同期注意喚起済み）
- `messaging/types.ts` は content script から参照されるため、ランタイム依存を増やさない

## BDD受け入れシナリオ

```gherkin
Feature: メッセージング型統一

  Scenario: 全メッセージ種別が単一の型定義から派生する
    Given ExtensionMessage が messageTypes.ts で定義されている
    When messaging/types.ts が ServiceWorkerRequest を独自定義せず import type で参照する
    Then 新メッセージ種別の追加は messageTypes.ts のみの変更で完了する
    And 型ガード isServiceWorkerRequest が ExtensionMessage の全種別をカバーする

  Scenario: 不正な sender からのメッセージが拒否される
    Given sender.id が chrome.runtime.id と一致しないメッセージが届く
    When メッセージハンドラが処理を開始する
    Then sendResponse にエラーが返される
    And 記録処理は実行されない

  Scenario: createManualRecordHandler / createSaveRecordHandler がファクトリを使用する
    Given 2つのハンドラが動的 import から RecordingPipeline を構築する
    When createRecordingPipeline(deps) ファクトリ関数が利用可能である
    Then 両ハンドラともファクトリを使用し as any キャストが存在しない

  Scenario: 型の二重管理がない
    Given messageTypes.ts と messaging/types.ts の両方を検証する
    When どちらかのファイルに type 定義が追加された場合
    Then もう片方のファイルで型定義を重複して追加する必要がない
```

## 受け入れ基準
- [ ] `messaging/types.ts` の `ServiceWorkerRequest` 独立定義を削除し、`import type { ExtensionMessage }` 経由で参照
- [ ] `isServiceWorkerRequest()` 型ガードが `ExtensionMessage` の全18種をカバー（現在不足の4種: PING, REFRESH_LOCAL_MARKDOWN_SCHEDULER, CONSENT_STATE_CHANGED, DASHBOARD_SQLITE を追加）
- [ ] `sendServiceWorkerMessage()` / `sendFromPopup()` の型引数が `ExtensionMessage['type']` を使用
- [ ] `MessageHandlerRegistry` に sender.id 一括検証を追加（全ハンドラのエントリポイント）
- [ ] `createManualRecordHandler` / `createSaveRecordHandler` が `createRecordingPipeline(deps)` を使用し `as any` キャストが除去されている
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 統合テスト
- 全メッセージ種別が `isServiceWorkerRequest` を通過するテスト
- invalid sender でエラーレスポンスが返るテスト（service-worker.test.ts に追加）

### 単体テスト
- `ExtensionMessage['type']` で type パラメータを制約する sendServiceWorkerMessage の型テスト
- ファクトリ関数の呼び出しテスト（既存の saveSqliteStep テストを拡張）

## 実装アプローチ
- **Outside-In**: まず `messaging/types.ts` の `ServiceWorkerRequest` を `import type` に置き換える。次に `isServiceWorkerRequest` を全種別カバーに拡張。続いて `MessageHandlerRegistry` で sender.id 検証を追加。最後に Pipeline ファクトリ使用に置き換え。
- **変更影響範囲**: 変更は型定義とハンドラが中心で、ランタイムロジックへの影響は最小限。テストファイルの更新が必要。

## 見積もり
5pt（型構造変更 + sender.id 検証追加 + ファクトリ置換 + テスト更新）

## 技術的考慮事項
- `messaging/types.ts` の `ServiceWorkerRequest` は content script（loader.ts）から使用されているため、`import type` に変更後もランタイムに影響しない
- `loader.ts` の `CURRENT_PROTOCOL_VERSION` 定数（重複定義）は ESM 未対応の制約のため現状維持。コメントで同期注意喚起が既にある
- sender.id 検証は `chrome.runtime.id` との比較、MessageHandlerRegistry のディスパッチ前に一括実行

## 落とし穴
- `ServiceWorkerRequest` を削除すると、content script 側でインポートしている箇所がコンパイルエラーになる。事前に全参照を `ExtensionMessage` に置き換えること
- `VALID_MESSAGE_TYPES`（messageTypes.ts）と `validTypes`（messaging/types.ts）の値が既に不一致（18種 vs 15種）。統合後は `VALID_MESSAGE_TYPES` を唯一の情報源とし、`validTypes` の配列は削除する

## Definition of Done
- [ ] messaging/types.ts の ServiceWorkerRequest 独立定義が削除されている
- [ ] sender.id 検証が MessageHandlerRegistry で全ハンドラに適用されている
- [ ] Pipeline ファクトリ使用に統一されている
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
