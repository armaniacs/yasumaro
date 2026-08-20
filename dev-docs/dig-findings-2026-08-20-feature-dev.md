# 深掘りセッション — 2026-08-20 Feature Dev (PBI 3件)

対象: 推奨順 PBI 3件の自律実装
- 2026-08-21-01 diagnosticsPanel Wave2
- 2026-08-22-02 utils layer boundary
- 2026-08-23-03 messaging validator interface

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| diagnosticsPanel Wave2 は Collector 統合まで含むべき | 高 | DiagnosticsCollector は 2026-08-20-04 で深モジュールとして新設済みだが、diagnosticsPanel.ts は依然 loadAndPopulate() で直接 getSettings/getSqliteStatus を呼ぶ。PBI 2026-08-21-01 の受け入れ基準は「PanelLifecycle直接実装＋adaptLegacyPanel削除＋lifecycleテスト」のみで Collector への委譲は含まれない。Collector 統合は別責務であり、同時に行うと 681行の描画ロジックと lifecycle 移行の2つの変更理由が混在し、レビュー時の差分が 500行超になる。Wave1 sqliteHistoryPanel も controller 分離と lifecycle 移行を別 PBI に分けていた | **A: ライフサイクルのみ** — mount/load/destroy への移行とラッパー削除に限定。Collector 統合は次 Wave の候補として記録。loadAndPopulate は load() に移動するが、内部実装は維持 |
| utils layer 形式化はドキュメントのみで十分 | 中 | src/utils/storage.ts は 88行38exportの barrel で 36箇所から参照、logger.ts も ~120箇所。barrel を一気に分割すると破壊的変更。一方で「ドキュメントのみ」ではコード上で layer 違反を grep 検証できず、PBI の「形式化（comment marking）」要件を満たさない。trustDb↔settingsStore 循環は双方 dynamic import で回避済みだが、なぜそうなっているかがコードに残らないと将来削除されるリスク | **B: ドキュメント＋コメントマーキング** — dev-docs/LAYERS.md 作成＋ADR に循環記録＋全 utils ファイル先頭に // Layer 0/1/2 コメント付与。barrel 分割は行わない。grep で layer 違反を検出可能な最小のコード変更 |
| messaging validator は 5 validator を throw で統一 | 中 | 実コードでは sqliteValidators.ts の pure helpers 以外に独立 validator ファイルは存在せず、handler 内に散在する inline check (isSecureUrl, MAX_* 上限, confirmToken ゲート, rateLimiter など) のみ。PBI の「5ファイル」は歴史的記述で実態は 3 domain (SQLite, BrowsingLog, AIResponse) に集約可能。既存の requiredFiniteNumber は throw、Dashboard の ServiceResult は {error} 返却だが、MessageHandlerRegistry.dispatch は handler の throw を catch して {success:false} で応答する設計のため throw が自然。Result 型は既存 ServiceResult と紛らわしく、二重の型が発生する | **A: throw統一・SQLite中心** — MessageValidator<T> { validate(msg:unknown):T } を throw ValidationError で定義。対象は SqliteMessage/BrowsingLog/AIResponse の3つに絞り、残りは inline のまま。Handler registry で validator を DI し、throw を catch して structured log に記録 |

## なぜなぜ分析サマリ

### 01 diagnosticsPanel: なぜ Collector が未配線なのか？
- なぜ1: なぜ diagnosticsPanel はまだ god module なのか？ → DiagnosticsCollector は深モジュールとして抽出されたが、panel 側の消費まで PBI が届かなかった
- なぜ2: なぜ PBI が分断されたのか？ → 深深化 PBI (2026-08-20-04) は「収集を Snapshot に集約」までを Done と定義し、panel の lifecycle 移行は別 PBI (2026-08-21-01) に委譲した
- なぜ3: なぜ同時に行わなかったのか？ → 1 PBI で 681行の分解と lifecycle 移行を同時に行うと、テストの失敗原因が lifecycle なのか収集ロジックなのか切り分け不能になる
- 解: 今回は lifecycle 移行に専念し、Collector 配線は次 Wave で行うことで、失敗の局所化を保つ

### 02 utils layer: なぜ層が文書化されていないのか？
- なぜ1: なぜ src/utils/ に層がないのか？ → de facto で Layer 0 は依存なし、Layer 1 は storage 依存として機能していたが、暗黙知のため新規開発者が誤配置する
- なぜ2: なぜ barrel が残るのか？ → 36箇所が barrel に依存し、分割は破壊的。段階的移行の前にまず「層を可視化」するのが低リスク
- なぜ3: なぜ循環が放置されたのか？ → trustDb と settingsStore が Tranco version を相互に参照する業務ルール上不可避。dynamic import で回避したが、理由が ADR にないと「なぜこんな複雑な import？」と削除される
- 解: ドキュメント＋コメントで可視化し、barrel 分割は将来の PBI で段階的に行う

### 03 messaging validator: なぜ validator が散在するのか？
- なぜ1: なぜ 5ファイルに散在するのか？ → messaging protocol が domain ごとに別々に成長し、型は types.ts に統一されたが validator は追従しなかった
- なぜ2: なぜ handler が個別に validation するのか？ → DI パターンが未確立で、handler が各自で payload の存在確認をしていた
- なぜ3: なぜ統一されないのか？ → validator interface が存在せず、schema 変更時に 5箇所を手作業で更新する必要があった
- 解: MessageValidator<T> を単一 interface として定義し、handler registry に登録することで「どの handler がどの validator を使うか」を明示する

## 新たに発見したリスク
- diagnosticsPanel の NavigationRegistry 呼び出しは category==='async-data' のみ load() を自動実行するが、diagnostic は static 的に扱われるため load() が自動で呼ばれない可能性がある — appConstants 的に diagnostic は mount で完結する設計のため、load() をどこで呼ぶかを設計で決める必要がある
- utils の storage/storageMaintenance.ts が background/sqliteClient.ts に dynamic import で依存しており、utils→background の逆方向依存が層違反 — LAYERS.md で明示的に例外として記録する必要がある
- messaging の DASHBOARD_SQLITE は 20 subtype が既に sqliteOperationSecurity.ts で SSOT 化されているため、新 validator はそれと整合させる必要がある

## 未解決の疑問
- diagnosticsPanel の refresh() を load() に統合するか、別途残すか — 既存は refresh?() を持つが NavigationRegistry は refresh を呼ばない。今回は load() に統合し refresh は削除する方針で進める
- utils の Layer 1 に trustDb を含めるか — trustDb は storage に依存するが循環するため「Layer 1 (循環あり)」として例外扱いにする

## 決定事項
1. Wave2 diagnosticsPanel は lifecycle 移行のみ (A)
2. utils layer は ドキュメント＋コメントマーキング (B)
3. messaging validator は throw 統一・SQLite中心の3 validator (A)
4. いずれも 2pt 以内で完結するようスコープを絞る。Collector 配線や barrel 分割は次 Wave に送る

