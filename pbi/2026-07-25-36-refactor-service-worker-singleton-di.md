# PBI: Service Worker上のモジュールレベルシングルトンを遅延初期化パターンへ移行する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🔴高（3pt以上目安、Epic規模の可能性あり）
**副作用**: 🔴あり（拡張機能の全機能（記録・AI要約・Obsidian連携・SQLite）の起動シーケンスに関わる根本的な構造変更。着手前にシニアと設計相談すべき規模）

---

## 背景

Checking Team レビュー（2026-07-25）の System Architect からの指摘。`ObsidianClient`, `AIClient`, `LocalAIClient`, `RecordingLogic`, `TabCache`, `SqliteClient` など多数のシングルトンがService Worker上でモジュールレベルにインスタンス化されている。テスト時にモック化が困難で、Service Worker再起動時に状態が失われ、起動順序への暗黙的な依存が存在する。

コンフリクト調整結果（レポート169-175行）では「依存関係を明示的なDIコンテナに移行するか、遅延初期化パターンを導入する」ことが推奨されている。またRed Team Leaderの「SWモジュールレベル状態の不整合」指摘（PBI-35）とも密接に関連する — PBI-35が「状態の永続化」に焦点を当てる一方、本PBIは「初期化順序と依存関係の明示化」に焦点を当てる。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "^const.*=.*new \|^let.*=.*new " src/background/service-worker.ts
grep -n "class ObsidianClient\|class AIClient\|class LocalAIClient\|class RecordingLogic\|class TabCache\|class SqliteClient" -r src/background/
```

**このPBIはEpic規模（3pt以上、実質的にはアーキテクチャ変更）である。着手前に必ずシニアエンジニアと設計方針（DIコンテナ導入 vs 遅延初期化パターンのみ採用）を相談すること。** 一度に全シングルトンを移行せず、影響範囲の小さいクライアント（例: `TabCache`）から段階的に移行し、パターンを確立してから他へ展開する方針を推奨する。

## 受け入れ基準（BDD）

```gherkin
Scenario: シングルトンが遅延初期化される
  Given service-worker.ts でモジュールレベルに new ObsidianClient() 等が書かれている
  When 遅延初期化パターン（getInstance()関数、初回呼び出し時に生成）に変更する
  Then モジュール読み込み時ではなく、実際に必要になった時点でインスタンスが生成される

Scenario: テストでモック化が容易になる
  Given 遅延初期化パターンに移行した各クライアント
  When ユニットテストでこれらのクライアントをモックに差し替える
  Then モジュールレベルのimport時点での副作用なしにモック注入ができる

Scenario: 起動順序への暗黙的依存が解消される
  Given 複数のクライアントが相互に依存している
  When 依存関係を明示的なコンストラクタ引数または初期化関数の引数として渡す
  Then コードを読むだけでどのクライアントがどれに依存しているか分かる

Scenario: 既存の記録機能が回帰しない
  Given リファクタリング後のservice-worker.ts
  When 既存の記録フロー（AI要約生成 → Obsidian書き込み）の統合テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] 対象シングルトン（`ObsidianClient`, `AIClient`, `LocalAIClient`, `RecordingLogic`, `TabCache`, `SqliteClient`）ごとに、他への依存関係を図示する
- [ ] 影響範囲の小さいクライアント（例: `TabCache`）から遅延初期化パターン（`getInstance()`関数）への移行を試験導入する
- [ ] 試験導入が成功したら、残りのクライアントへ段階的に展開する（1クライアントにつき1PR相当を推奨）
- [ ] 各クライアントの単体テストでモック注入が容易になったことを確認する
- [ ] 既存の記録フロー統合テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 統合テスト
- 記録フロー全体（URL記録 → AI要約 → Obsidian書き込み）が遅延初期化後も正しく動作することを確認

### 単体テスト
- 各クライアントの `getInstance()` が同一インスタンスを返す（シングルトン性が保たれる）ことを確認
- テスト用にモッククライアントを注入できることを確認
- 依存関係の初期化順序が正しいことを確認（依存先が未初期化の状態でアクセスされないこと）

### E2Eテスト（最小限）
- 拡張機能を実際に読み込み、記録・要約・Obsidian書き込みが一連で動作することを確認

## 実装アプローチ

1. 各シングルトンクライアントの依存関係図を作成
2. 影響範囲の小さい `TabCache` から `getInstance()` パターンへの移行を試験実装
3. テストでモック注入の容易さを検証
4. パターンが確立したら、`SqliteClient` → `ObsidianClient` → `AIClient`/`LocalAIClient` → `RecordingLogic` の順（依存の少ない順）で段階的に移行
5. 各段階で統合テストを実行し回帰がないことを確認

## 見積もり

Epic規模（5pt以上を想定）。着手前にシニアエンジニアとの設計相談を必須とする。段階ごとに分割PBI化することを推奨。

## 技術的考慮事項
- 依存関係: `src/background/service-worker.ts` 全体、全クライアントクラス
- テスタビリティ: モック注入の容易さが主目的
- 非機能要件: Service Workerライフサイクル対応（[AGENTS.md](../AGENTS.md) Concurrency Management参照）
- 関連PBI: `2026-07-25-35-fix-service-worker-state-persistence.md`（状態永続化と合わせて設計すると効率的）

## Definition of Done
- [ ] 依存関係図が作成されている
- [ ] 少なくとも1クライアント（TabCache）で遅延初期化パターンが試験導入されている
- [ ] テストでモック注入の改善が確認されている
- [ ] 既存の統合テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（System Architect指摘、コンフリクト調整結果で合意済みの方針）
- 対象コード: `src/background/service-worker.ts:192-228`

## フェーズ0再調査（2026-07-27）

`service-worker.ts`は654行→686行に増加。行番号は`192-228`→`197-215`付近にズレているが、
`obsidian`/`aiClient`/`localClient`/`aiService`/`sqliteClient`/`recordingLogic`/`migrationService`/
`tabCache`が全てモジュールレベルで`new`されている実態は記載通りで指摘は健在。

**新規発見（要着手前確認）**: 211-212行付近に`import { RecordingPipeline } from './pipeline/RecordingPipeline.js';`
という未使用のimportが、シングルトン変数宣言の途中に混入している。`RecordingPipeline`はこのファイル内で
一度も使われておらず、デッドコードの可能性が高い。着手前に「削除するか、本格的にDIへ組み込むか」を
判断する必要がある（前回セッション以降に紛れ込んだコードで、PBI策定時にはなかった）。

**PBI-29（God File分割）との関係**: 本当に競合するのはPBI-29と本PBI（ファイル分割とシングルトン注入は
同じインスタンス化コードに触れる）。PBI-29が推奨する「先にファイル分割 → 分割後の各モジュールでDI導入」
という順序が妥当。

**見積もり再評価**: Epic規模（5pt以上）のまま変化なし。未使用importの扱いという新しい論点が1つ増えたが、
全体の規模を動かすほどではない。
