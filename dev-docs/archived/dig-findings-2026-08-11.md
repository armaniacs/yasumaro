# Deep-Dig Findings — 2026-08-11

6つの未完了PBIを実装前に深掘り検証。各PBIの隠れた仮定をwhy-why分析で顕在化し、設計判断と未解決の疑問を記録する。

---

## 挑戦した仮定

| PBI | 仮定 | リスク | 発見 | 決定 |
|-----|------|--------|------|------|
| 07 reducer統一 | reducerを唯一のstate変更経路にすれば挙動ドリフトがなくなる | 中 | 直接mutationは37箇所あり、内14箇所がselectedIdsの直接add/delete/clear。DOM listenerのclosure内でstateを直接書き換えている | DOM listenerはaction dispatchのみ行い、state更新はreducer経由に集約する |
| 07 reducer統一 | `refresh()`はreducer適用後に呼べば十分 | 低 | `refresh`は`sqliteHistoryPanel.ts`内で定義されたpanel closureの関数。reducer適用後に呼び出してDOMを再描画する形が自然 | 既存の`refresh`呼び出しパターンを維持し、state変更だけをreducerへ移行 |
| 09 fallback失敗 | fallback失敗時に未フィルタ行を返すのは誤り | 中 | `sqliteHistoryQuery.ts:295-300`で`isServiceError(searchResult)`時に`rows = queryResult.data.rows`に fallback。これはtag filterを無視した5000行のover-fetch行 | fallback失敗時はServiceErrorを返し、panel側でerror表示する |
| 09 fallback失敗 | 失敗と0件を区別するUIが既存にある | 低 | panel側は`loadFailure` actionでerror stateを持つ。空結果は`loadSuccess` with total=0。区別可能 | 現状のUI契約を維持し、fallback失敗はerror stateへ伝播 |
| 08 metadata queue | content/AI summaryを含むpatchがqueueに保存される | 高 | `saveMetadataStep.ts:173`でpatch全体を`enqueuePendingWrite`に渡す。contentが大きい場合、storage quotaを圧迫 | byte上限を設け、超過時はcontentを分離して再取得情報を保持 |
| 08 metadata queue | 同一URLのpatchを統合できる | 高 | queueは単純なappend。同一URLへの複数patchが件数とbyte数を増やす。mergeTags規則の整合性が必要 | coalescing時に`mergeTags=true`とtimestamp優先を維持 |
| 08 metadata queue | 大容量contentをqueueから除外して再取得可能 | 中 | contentはページから抽出済みで、retry時に再取得するにはURLだけでは不十分（timestampで特定）。contentを失うと復旧不能 | URL+timestampを保持し、content分離時は「content欠落」フラグを付けて明示的に扱う |
| 01 Epic | 5つの子PBIが完了すればEpicも完了に近い | 中 | INDEXによると「handler registry移設のみ範囲外として残存」。Epicの完了条件には含まれていないが、技術的負債として残存 | Epicの完了条件を再定義するか、handler registry移設を別PBIとして切り出す |
| 01 Epic | handler registry移設が必要 | 高 | 実施順には含まれていないが、依存関係図の最上位に位置づけられる可能性がある。現状のcomposition rootは`service-worker.ts` | 実装計画作成前に、handler registryの現状と移設先を調査 |
| 08 AI統合 | AIClientは削除または薄いラッパー化すべき | 高 | `RemoteAIService.ts:10-32`が`aiClient`を注入受け。`aiClient.test.ts`等がAIClientを直接テスト。削除は破壊的変更 | 第一候補は委譲ラッパー化。テストは段階的にAIService経由へ移行 |
| 08 AI統合 | `modelName`型統一が可能 | 低 | `ProviderStrategy.ts:47-55`は既に`modelName`を使用。`AIService.ts:17`も`modelName`。型ドリフトは既に解消済みとのPBI注記を確認 | 型統合は既存状態を検証して完了宣言。残るはAIClientの委譲化 |
| 08 AI統合 | FallbackAIServiceがAIClientのスロットループを置き換えられる | 高 | `aiClient.ts:174-238`の`generateSummaryInternal`と`283-429`の`testConnection`が重複するスロットループ。`FallbackAIService.ts:58行`で簡潔 | スロットループをFallbackAIServiceまたは新しいdispatch moduleに集約し、AIClientは薄い委譲 |
| 17 encryption session | chrome.storage.sessionへの移行がセキュリティを向上させる | 高 | `encryptionSession.ts:145-159`で`ENCRYPTION_SECRET`/`ENCRYPTION_SALT`がstorage.localに平文保存。session storageはSW終了時に消滅 | マスターパスワード未設定時のderived keyを非抽出CryptoKeyとしてsession storageに保持 |
| 17 encryption session | 再設定導線をユーザーが受け入れる | 高 | SWは30秒非アクティブ後に終了。頻繁に鍵が失われ、APIキー再入力が必要になる可能性 | UX影響を実機で検証。頻度が高い場合はマスターパスワード推奨フローに誘導 |
| 17 encryption session | PRIVACY.md更新が必要 | 低 | `docs/PRIVACY.md`/`public/PRIVACY.md`には既に「未設定時は鍵が平文保存」と開示済み。挙動変更後は文言更新が必要 | 両ファイルを同期して更新 |

---

## 新たに発見したリスク

1. **PBI-07のDOM listener closure**: `state.selectedIds.add(id)`等がlistener内で直接実行されており、reducer化時に`selectionChange` actionのdispatchに置き換える必要がある。同時に`updateBulkBar`の呼び出し位置も見直しが必要
2. **PBI-07の重複したlistener定義**: `sqliteHistoryPanel.ts:512-535`と`831-849`で似たlistenerが2箇所定義されている。同じstate mutationが重複して存在
3. **PBI-09のlegacy panel影響**: 「既存のlegacy panelとduplicate checkのquery経路は変更しない」とあるが、`sqliteHistoryQuery.ts`を変更すると影響を受ける可能性がある。呼び出し元を事前に調査が必要
4. **PBI-08のcontent再取得困難**: contentはページから抽出されたもので、retry時に再取得するには同じDOM状態が必要。URL+timestampだけでは再取得不可能なケースがある
5. **PBI-08のqueue満杯時の挙動**: `maxSize`到達時に`PersistentRetryQueue`が何をするか確認が必要。暗黙の削除が発生する可能性
6. **PBI-01のEpic完了定義の曖昧さ**: 「handler registry移設のみ範囲外として残存」とあるが、これはEpicのスコープ外か、別PBIとして残存しているかが不明確
7. **PBI-08 AI統合の`RemoteAIService`削除**: `RemoteAIService`が`aiClient`に依存しているため、AIClient削除または薄化時に`RemoteAIService`も再設計が必要
8. **PBI-17のService Worker頻繁終了**: `chrome.storage.session`はSW終了で失われる。SWの起動頻度は想定より高く、UX影響が大きい可能性

---

## 未解決の疑問

- PBI-07: 重複するDOM listener（lines 512-535 と 831-849）を統合するか、それぞれ別の文脈か
- PBI-07: `state.loading = true`/`state.error = null`等の直接代入（lines 922-934）もreducer経由にするか
- PBI-08: `PersistentRetryQueue`の`maxSize`超過時の挙動（エラーthrow/暗黙削除/無視）
- PBI-08: content分離時に「再取得」は技術的に可能か。ページ内容が変化しているケースの扱い
- PBI-01: handler registry移設はEpicの完了条件に含めるか、別PBIとして切り出すか
- PBI-08 AI: `aiClient.test.ts`等をAIService経由に移行する工数と影響範囲
- PBI-17: SW終了頻度の実測値と、再設定導線の頻度に対するユーザーの許容範囲
- PBI-17: マスターパスワード未設定ユーザーへのマスターパスワード推奨フローが必要か

---

## 決定事項

1. **PBI-07**: DOM listener内の直接state mutationを`historyStateReducer` action dispatchに置き換える。重複listenerの統合は別途検討
2. **PBI-07**: `selectedIds`のSet操作はreducer内で新しいSetを返す形に統一
3. **PBI-09**: fallback失敗時は未フィルタ行を返さず、`ServiceError`を返す。panelは既存のerror stateで表示
4. **PBI-08**: metadata patchにbyte上限を設け、超過時はcontentを分離。URL+timestampと「content欠落」フラグを保持
5. **PBI-08**: 同一URL patchのcoalescingを実装。`mergeTags=true`と最新timestampを維持
6. **PBI-01**: Epicの完了条件を再定義。handler registry移設を別PBIとして切り出すか、Epicの子PBIとして追加するかを決定
7. **PBI-08 AI**: AIClientは薄い委譲ラッパー化。`RemoteAIService`も`AIClient`から`AIService`プロバイダー構成へ移行
8. **PBI-17**: 暗号化鍵を`chrome.storage.session`に非抽出CryptoKeyとして保持。再設定導線を実装し、PRIVACY.mdを更新
9. **PBI-17**: 実機でSW終了頻度を測定し、UX影響が大きい場合はマスターパスワード推奨フローを追加

---

## 補足: 20+ Whys分析の要約

### PBI-07 reducer統一（6回）

- なぜstate変更が直接mutationとreducerの二重経路にあるのか？
  - reducerを後から導入したが、listener closure内の書き換えが移行されていないから
- なぜlistener closure内の書き換えが移行されていないのか？
  - DOM操作とstate更新が同じクロージャ内で密結合しているから
- なぜ密結合しているのか？
  - panelの初期設計でstate seamを分離していなかったから
- なぜstate seamを分離していなかったのか？
  - 当時はDOM依存のテストのみで十分と判断していたから
- なぜDOM依存のテストだけでは不十分なのか？
  - jsdomの制約と再現性の低さにより、state遷移の網羅的検証が困難だから
- なぜ再現性が低いのか？
  - DOMイベントの順序や非同期fetchの応答タイミングがテストごとに変動するから

**根本原因**: panel closureがstate更新とDOM更新を同じスコープで管理していた。
**解決策**: listenerはactionをdispatchするのみとし、state更新はreducerへ完全委譲。

### PBI-09 fallback失敗（5回）

- なぜfallback失敗時に未フィルタ行が返されるのか？
  - `sqliteHistoryQuery.ts`の実装で、失敗時に元の5000行クエリ結果をそのまま使うから
- なぜ元の5000行をそのまま使うのか？
  - 「何か表示する方が良い」という防御的な実装だったから
- なぜ「何か表示する方が良い」実装が誤りなのか？
  - tag filter条件を満たさない行まで表示され、ユーザーに誤った成功印象を与えるから
- なぜtag filter条件を満たさない行が表示されるのか？
  - tag filterはクライアント側で適用されており、全文検索fallbackは別のマッチングロジックだから
- なぜ別のマッチングロジックが問題なのか？
  - ユーザーは「tag AIで検索した」と認識しているが、実際は無関係な行が混在するから

**根本原因**: fallback失敗時にエラー表示を避けるために、不正確な中間結果を成功として返していた。
**解決策**: fallback失敗を明示的なServiceErrorとして返し、panelのerror stateで表示。

### PBI-08 metadata queue容量（6回）

- なぜmetadata patch queueが肥大化するのか？
  - `saveMetadataStep`がcontent/AI summaryを含むpatchをqueueに保存するから
- なぜcontentをqueueに保存するのか？
  - storage障害時にretryで同じpatchを再現するため
- なぜretryで同じpatchを再現する必要があるのか？
  - `saveSavedUrlEntryMetadata`はcontentを含む完全なmetadata更新を期待しているから
- なぜ完全なmetadata更新が必要なのか？
  - 部分的な更新を許すと、既存のsaved URL entryのデータ整合性が崩れるから
- なぜデータ整合性が崩れるのか？
  - mergeTags等のフィールド統合ロジックがあり、部分的更新が想定されていないから
- なぜ部分的更新を避けられないのか？
  - 大容量contentを含むpatchはstorage quotaを超える可能性があるから

**根本原因**: retryのためのqueue永続化と、完全なmetadata更新の要求が矛盾している。
**解決策**: byte上限を設け、超過時はcontentを分離してURL+timestamp+欠落フラグを保持。retry時はcontentの有無を明示的に扱う。

### PBI-01 Epic残存（5回）

- なぜEpicが部分実装のまま残っているのか？
  - handler registry移設が範囲外とされたから
- なぜhandler registry移設が範囲外とされたのか？
  - 影響範囲が大きく、子PBIの依存関係に含まれていなかったから
- なぜ影響範囲が大きいのか？
  - service workerのcomposition rootとhandlerの関係が複雑だから
- なぜcomposition rootとhandlerの関係が複雑なのか？
  - handlerが独自の依存を持ち、registryがそれらを解決しているから
- なぜhandlerが独自の依存を持つのか？
  - 各handlerが異なるclient/storage/設定にアクセスしているから

**根本原因**: handlerの依存解決が分散しており、composition rootへの集約が当初のスコープに含まれていなかった。
**解決策**: Epicの完了条件を再定義し、handler registry移設を別PBIまたは追加子PBIとして計画。

### PBI-08 AI統合（6回）

- なぜAIClientとAIServiceが二重にあるのか？
  - AIServiceへの段階的移行が完了していないから
- なぜ段階的移行が完了していないのか？
  - AIClientの削除は中核パスであり高リスクだから
- なぜ高リスクなのか？
  - 多くのテストと既存のフォールバック動作がAIClientに依存しているから
- なぜテストがAIClientに依存しているのか？
  - AIService経由のテストが未整備だから
- なぜAIService経由のテストが未整備なのか？
  - `RemoteAIService`がまだAIClientを注入しているため、AIService単体では完全なカバレッジが取れないから
- なぜRemoteAIServiceがAIClientを注入しているのか？
  - 移行第一弾で既存ロジックを再利用するための橋渡し実装だったから

**根本原因**: 移行の橋渡しとして`RemoteAIService`がAIClientに依存したまま固定化された。
**解決策**: `RemoteAIService`をAIServiceプロバイダー構成に移行し、AIClientは薄い委譲ラッパー化または段階的に削除。

### PBI-17 encryption session（7回）

- なぜ暗号化鍵がstorage.localに平文保存されているのか？
  - マスターパスワード未設定時のフォールバック方式だから
- なぜフォールバック方式が必要なのか？
  - 暗号化・復号に鍵が必要で、マスターパスワードが設定されていないユーザーもいるから
- なぜマスターパスワードが設定されていないのか？
  - デフォルトでは未設定であり、設定フローが追加のユーザー操作を要求するから
- なぜデフォルトが未設定なのか？
  - オンボーディングを簡易にし、利便性を優先していたから
- なぜ利便性を優先していたのか？
  - マスターパスワードは再起動ごとの再入力が必要で、ユーザー負担が大きいから
- なぜ再入力が必要なのか？
  - マスターパスワード自体を永続化しない設計だから
- なぜマスターパスワードを永続化しないのか？
  - パスワードを保存するとセキュリティが低下するため、メモリキャッシュのみにするから

**根本原因**: 利便性のためのデフォルト未設定が、鍵の永続化を強いてしまい、セキュリティと利便性のトレードオフを生んでいる。
**解決策**: マスターパスワード未設定時はderived keyを非抽出CryptoKeyとして`chrome.storage.session`に保持。SW再起動時に失われることを受け入れ、再設定導線またはマスターパスワード推奨フローを提供。

---

## 分析サマリー

合計 why-why 回数: **35回以上**（PBI 07:6, 09:5, 08 queue:6, 01 Epic:5, 08 AI:6, 17:7）

最も緊急度の高いリスク:
1. PBI-17: デフォルト構成でのAPIキー保護レベルが低い（セキュリティ）
2. PBI-08: storage障害時のqueue肥大化が復旧処理を妨害（信頼性）
3. PBI-09: fallback失敗時の誤った成功表示（UX・信頼性）

推奨着手順の再検討:
1. PBI-09（副作用🟡軽微、範囲が狭い）
2. PBI-07（副作用🟡軽微、reducer整備で他の修正の土台になる）
3. PBI-08（副作用🔴あり、信頼性向上）
4. PBI-01 Epicの完了条件整理（handler registry移設の扱い決定）
5. PBI-08 AI統合の委譲化（🔶部分実装の完結）
6. PBI-17（🔴あり、UX影響大。実機検証が必要）

---

## 追加調査で解消した疑問

### PBI-07: 重複listenerの正体
- `updateDynamicRegions()` (lines 500-538) は動的再描画用
- `renderState()` (lines 820-850) は初期描画用
- 両者で同じlistener closureを定義しており、コード重複があるが機能的には同じ
- `retryInitialLoad` (lines 919-939) では `state.loading`/`state.error` を直接代入
- `unmount` (line 986) では `state.selectedIds.clear()` を直接実行

**解決**: 両方のlistenerをreducer action dispatchに置き換え、`retryInitialLoad`は`loadStart`/`loadFailure` actionを使用、`unmount`は`clearSelection` actionを使用する。

### PBI-08: `PersistentRetryQueue` の挙動
- `maxSize` 超過時は先頭（最古）のアイテムをdropする（`persistentRetryQueue.ts:78-84`）
- `maxPayloadBytes` は存在するが、`PendingMetadataPatchWrite` は `RetryableItem` （`createdAt`/`retryCount`）を実装していないため、現状のpayload size checkは適用されていない
- `PendingMetadataPatchWrite` に `createdAt`/`retryCount` を追加するか、専用のsize/coalescingロジックが必要

**解決**: `PendingMetadataPatchWrite` を `RetryableItem` 化し、`maxPayloadBytes` を有効にする。同一URL coalescingはenqueue前に実施。

### PBI-08: content再取得の現実性
- contentはページから抽出されたもので、retry時に同じ内容を再取得することは技術的に困難
- URL+timestampのみでは、ページ内容が変化している場合に同じcontentが得られない
- しかし、storage障害時にcontentをqueueに入れておく目的は「metadata patchを再現する」ことであり、厳密な再取得より「失われたことを明示する」方が安全

**解決**: content分離時は `contentOmitted: true` フラグを付与。retry時にcontent欠落patchを検知して、部分的な更新（contentを除くfieldのみ）を試みるか、エラーとして記録する。

### PBI-01: handler registryの現状
- `service-worker.ts:290-318` で `createMessageHandlerRegistry` が構築されている
- `createMessageHandlerRegistry.ts` は `src/background/handlers/` にある
- Epicの子PBI 5（review summary AIService移行）が完了したため、message handlerは既に抽象化されている
- 残存の「handler registry移設」は、`createMessageHandlerRegistry` の呼び出しを `service-worker.ts` から `createBackgroundServices` または別のcomposition moduleに移すことを指す可能性がある

**解決**: Epicの完了条件を再定義。handler registry移設のスコープを明確にし、別PBIとして切り出すか、Epicの子PBIとして追加するかを決定。

### PBI-08 AI: `RemoteAIService` の依存
- `createAIService` (`aiServiceFactory.ts:27-37`) が `AIClient` を注入して `RemoteAIService` を作成
- `RemoteAIService.ts:10-32` の interface は `aiClient` に依存
- `AIClient.generateSummaryInternal` (lines 211-235) と `testConnection` (lines 242-313) がスロットループを実装
- `FallbackAIService` は local/remote の切り替えのみ担当

**解決**: `RemoteAIService` 内にスロットループを再実装し、`AIClient` は `RemoteAIService` の薄い委譲ラッパー化する。`aiClient.test.ts` 等は当面 `AIClient` 経由で動作し、段階的に `AIService` 経由へ移行。

### PBI-17: `chrome.storage.session` の寿命
- `headerDetector.ts:161` に「chrome.storage.session はブラウザセッション中は永続 (SW 再起動をまたいでも保持される)」と記載
- SW再起動だけでは鍵は消えず、ブラウザプロセスの終了・拡張機能の再読み込みで消える
- したがって、APIキー再入力は「ブラウザを閉じるたび」または「拡張機能を再読み込みするたび」
- SWの30秒タイムアウトではないため、UX影響は当初想定より小さい可能性がある

**解決**: PBI-17のBDDシナリオを修正。「ブラウザ再起動後」ではなく「ブラウザセッション終了後」または「拡張機能再読み込み後」に鍵が失われることを明記。実機検証では、ブラウザセッション維持中に鍵が保持されることも確認。
