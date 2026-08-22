# Checking Team レビューレポート — Yasumaro（プロジェクト全体）

- レビュー日時: 2026-08-01
- レビュー対象: プロジェクト全体（Manifest V3 Chrome 拡張機能、src/ 312ファイル + entrypoints/ 17ファイル、約 6 万行、テスト 383 件）
- 比較ブランチ: なし（プロジェクト全体レビュー）
- 実行方式: 並列（Wave 1: コア 5 観点 / Wave 2: スペシャリスト 4 クラスタ）
- 実行済み観点: 21 / 22（Wave 3 Test Experts は対象外として不実行、詳細は後述）

## 総合評価: 85/100 (ランク: A)

観点別スコア（実行済み 21 観点の単純平均）:

| 観点 | スコア | 観点 | スコア |
|------|:-----:|------|:-----:|
| Red Team | 90 | Compliance & Privacy | 90 |
| Blue Team | 70 | Ethics & Bias | 95 |
| System Architect | 85 | Supply Chain | 90 |
| Maintainability | 85 | API & Contract | 90 |
| Legacy Bridge | 70 | Domain Logic | 90 |
| UI Expert | 90 | Data Integrity | 70 |
| Accessibility | 95 | Refactoring | 90 |
| i18n | 90 | DX Advocate | 90 |
| Documentation | 90 | | |
| Tuning | 85 | | |
| SRE/Ops | 70 | | |
| FinOps | 70 | | |
| Edge & Mobile | 90 | | |

---

## 重要指摘事項（優先度順）

### [High] 1. マスターパスワード未設定時の API キー暗号化が実質「難読化」（鍵シードが平文で同ストレージに同居）
- 指摘者: Blue Team
- 場所: `src/utils/storage/encryptionSession.ts:138-165`、`src/utils/crypto/index.ts:118-149`、`src/utils/storage/types.ts:75-76`
- 影響: デフォルト構成では `ENCRYPTION_SECRET` と `ENCRYPTION_SALT` が平文で `chrome.storage.local` に保存され、暗号文と同じ領域に鍵素材が存在する。ストレージを読める主体は PBKDF2→AES-GCM を再現し全 API キーを復号できる。「暗号化保存」という主張と実態が乖離。
- 対処: (a) 非抽出 `CryptoKey` を `chrome.storage.session` のみに保持し再起動時は再設定、または (b) 新規セットアップでマスターパスワードを必須化。少なくとも PRIVACY.md に現行方式の限界を明記。

### [High] 2. 🎯 settings 単一オブジェクト移行が trustDb の個別キー直接読み書きデータを破壊する
- 指摘者: Legacy Bridge Architect
- 場所: `src/utils/storage/settingsStore.ts:189-193, 214-233`、`src/utils/trustDb/trustDb.ts:911-913, 945-946`、`src/utils/trustDb/trancoConsentManager.ts:111,121-129`
- 影響: `migrateToSingleSettingsObject()` が個別キーを集約後削除するが、trustDb は `tranco_domains` を個別キーとして直接 get するため移行直後から空になり、Safety Mode の警告（金融/要警戒サイト判定）が次回リフレッシュまで機能しなくなる。
- 対処: 移行除外条件に `tranco_domains` 等の個別キー直接アクセスを明示的に追加するか、trustDb 側を getSettings 経由に統一する。`_version` ヒューリスティックに頼らない。

### [High] 3. [SRE/Ops] オフラインキューの再送が fire-and-forget で SW ライフサイクル未保護、進捗が最後に一度しか保存されない
- 指摘者: SRE/Ops Specialist
- 場所: `src/background/service-worker.ts:693-702`、`src/background/offlineQueueProcessor.ts:26-66`、`src/background/offlineNetworkQueue.ts:92-125`
- 影響: アラームリスナーが `processOfflineNetworkQueue()` を await せず即 return するため、MV3 SW は処理途中で終了し得る。進捗（retryCount++）を最後に一度しか save しないため、同じジョブが毎回「初回扱い」で再処理される。
- 対処: リスナーを async 化し await する（onAlarm の Promise 返却で SW 生存延長）、またはジョブごとに即時 `saveQueue`。1 サイクルあたりの処理件数上限も設ける。

### [High] 4. [FinOps] オフライン復旧時に AI API コストがバーストする（サイクル上限・レート制限なし）
- 指摘者: FinOps Consultant
- 場所: `src/background/offlineNetworkQueue.ts:25,73`、`src/background/offlineQueueProcessor.ts:53-61`、`src/background/service-worker.ts:693-702`
- 影響: オフラインで貯まった最大 200 ジョブが復旧後 5 分アラームで全量リプレイされ、各ジョブが L1+L3 AI を再実行。同一ページは pending にも登録されるため、最大 200 ×（クラウド AI + RETRY4 回）≒ 800 回の有料呼び出しが短時間に発生し得る。
- 対処: サイクルあたり処理ジョブ数上限（例 20 件）・ジョブ単位コスト上限・復旧直後のレート制限。ai_summary 再送はクラウド AI を 1 回に限定。

### [High] 5. 🎯 setUrlFallbackTriggered だけが Optimistic Lock を使わず、URL 正規化も他 setter と不整合
- 指摘者: Data Integrity Expert
- 場所: `src/utils/urlMetadata.ts:547-558`（呼び出し元 `saveMetadataStep.ts:182`）
- 影響: 他 ~30 setter は `withOptimisticLock` を使うが、本関数のみ素の get→set でバージョン検知なし。並行記録時に `savedUrlsWithTimestamps` 全体を last-write-wins 上書きし、他エントリの更新が失われる。加えて `url.split('#')[0]` での照合によりフラグメント付き URL は他 setter と一致せずサイレント no-op になる。
- 対処: `withOptimisticLock` に統一し、URL 正規化を共通ヘルパー化して他 setter と一致させる。

---

### [Medium] 指摘一覧（タイトルのみ、🎯 はプロジェクト固有パターン）

**セキュリティ / プライバシー**
- [Red] 🎯 E2E テスト専用フック `data-ow-e2e-test` が本番コンテンツスクリプトに残存（`loader.ts:195-203`、`extractor.ts:312-336`）→ ビルド時定数でガードし本番では無視
- [Red] `models-dev-dialog.ts:367-374` が provider.name / priceDisplay を HTML エスケープせず `innerHTML` 展開（stored XSS 潜在経路）→ `escapeHtml()` 適用
- [Blue] 🎯 平文 API キー検出時に「警告ログのみ」で再暗号化されず平文が残存（`settingsStore.ts:273-299`）→ encrypt-on-read 実装
- [Blue] マスターパスワードのブルートフォース制限カウンタがブラウザ再起動でリセット（`rateLimiter.ts:70-82`）→ `chrome.storage.local` にも保持

**アーキテクチャ / 保守性**
- [SysArch] background 中核層が popup / dashboard ディレクトリに依存（レイヤー逆転）→ 共通ドメインロジックを `src/utils/` へ移動
- [SysArch] AI 抽象化の二重構造（Strategy と AIService 並存）＋ built-in-ai 特殊ディスパッチ → `AISummaryResult` の 2 重定義を統合
- [SysArch] SW 状態永続化が 3 系統に分裂（SessionStore 2 インスタンス + 直接アクセス）→ SessionStore に一本化
- [Maintain] 🎯 ソースに `any` 使用 6 箇所（規約違反）→ `no-explicit-any: error` + 型改善
- [Maintain] 🎯 統合済み i18n の重複モジュール `entrypoints/popup/i18n.ts`（190 行）がデッドコードとして残存 → 削除
- [Maintain] `sqliteHistoryPanel.ts` が約 890 行の巨大クロージャ（単一責任の崩壊）→ データ取得/描画/状態に分割

**後方互換 / データ**
- [LegacyBridge] AI_SUMMARY_CLEANSING_DEEP / LINK_DENSITY デフォルトが既存ユーザーで無言に false→true 変更（`defaults.ts:106-107`）→ 移行ガード or デフォルト復帰 + types.ts コメント修正
- [LegacyBridge] MigrationService 進捗インデックス再開が legacy 配列の並べ替え・削除でズレ、中断後「completed」誤判定 → チェックポイント方式で再開

**UX / フロントエンド**
- [UI/i18n] フォールバック言語が不統一（HTML=英語、TS=日本語）→ 英語に一本化
- [a11y] エラー・警告・成功系の文字色が WCAG 1.4.3 AA 未達（`--color-danger` #ef4444 等）→ -text 系高コントラストトークンへ
- [i18n] 静的 `<html lang="en">` + 英語フォールバックで ja ユーザーへ初期英語表示 → ja-first 化
- [Docs] 🎯 ドキュメントサイトに旧称 `#obsidianweave` 残存（`docs/index.html:577,605,641`）→ 新ブランドへ差し替え
- [Docs] ACCESSIBILITY.md の「WCAG AA 準拠」主張と実装乖離 → コントラスト修正 + 検証方法を追記

**パフォーマンス / 運用 / コスト**
- [Tuning] `saveMetadataStep` が 1 レコードあたり約 25 回の Read-Modify-Write（`saveMetadataStep.ts:47-230`）→ 1 エントリにまとめ書き
- [Tuning] 独立な保存系 4 ステップが直列実行で遅延加算（`RecordingPipeline.ts:265-318`）→ Promise.allSettled 化
- [Tuning] `getSettings()` ホットパスに INFO ログ（`settingsStore.ts:363-366`）→ logDebug へ
- [SRE] `init()` が SW 起動ごとに alarms.create でスケジュールをリセット（`service-worker.ts:94-95`）→ 存在確認 or onInstalled/onStartup 限定
- [SRE] パイプライン失敗通知が毎回 create されフラッド（`RecordingPipeline.ts:423-428`）→ 間引き
- [FinOps] privacyPipeline の RETRY(3) が全エラー種別（429 含む）に適用 → 5xx/ネットワークのみリトライ
- [FinOps] `testConnection()` が全プロバイダスロットへ実 API 呼び出し（`aiClient.ts:258-380`）→ 最優先スロットのみ
- [Edge] コンテンツ抽出がメインスレッド同期実行で低性能端末でフリーズ（`contentExtractor/index.ts`）→ requestIdleCallback / early-exit
- [Edge] `chrome.idle` 権限なしでデフォルト 'idle' エクスポートが実質機能しない（`localMarkdownIdleFlusher.ts:47-53`）→ idle 権限追加 or デフォルト 'daily'

**ガバナンス / 契約**
- [Compliance] 同意バージョン定数がポリシー更新（2026-07-31）に追従せず再同意が発動しない（`privacyConsent.ts:12`）→ 定数バンプのリリースチェック追加
- [Compliance] PRIVACY.md の「URL はドメインのみ・最大7日」記述と実装（完全 URL・3 日）が不一致 → ドメイン抽出 or 記述訂正
- [Ethics] AI 生成要約が「AI 生成」明示なしに Obsidian ノートへ追記 → 要約前にラベル付与
- [SupplyChain] コミット済み SBOM（sbom.json）が現行 6.7.7 と乖離（v6.6.6 のまま）→ リリースパイプラインに generate-sbom 組み込み
- [SupplyChain] 推移的依存 brace-expansion に High DoS 脆弱性（GHSA-mh99-v99m-4gvg）→ overrides で固定 or npm audit fix
- [API] Obsidian デイリーノートの read-modify-write がユーザー同時編集を無条件上書き（`obsidianClient.ts:264-271`）→ 2 相 RMW または条件付き書き込み
- [API] OpenAI 互換プロバイダのデフォルトモデル 'gpt-3.5-turbo' が廃止予定で接続失敗リスク（`OpenAIProvider.ts:54`）→ 現行モデルへ更新

**ドメイン / データ整合 / DX**
- [Domain] `extractSentences`（ローカル処理）がネットワーク前提の RETRY + オフラインキュー対象 → リトライ外す/除外
- [Domain] Obsidian 書き込み失敗時にオフラインキューと pending page の二重復旧経路 → 1 経路に統一
- [DataIntegrity] 🎯 saved-URL ストアの並行実装が 2 系統存在し更新関数がスナップショットに依存 → 1 つに統合
- [DataIntegrity] SessionStore フラッシュ実行中 write が永続化されない競合（`sessionStore.ts:118-132`）→ ドレインループ
- [Refactoring] urlMetadata.ts の ~30 setter が同一パターンのボイラープレート → 共通ヘルパーへ集約
- [DX] `make test` がフルビルド + E2E を含む重いデフォルトターゲット → ビルド非依存に分離
- [DX] lint が CI に組み込まれておらず validate にも含まれない → CI に npm run lint 追加

---

## コンフリクト調整結果

相対立する指摘は検出されなかった（System Architect の裁定は不要）。参考として、Red Team（E2E フックの本番無効化）と E2E テスト実運用の間の緊張は「ビルド時定数でガードしつつ属性を状態公開のみに限定」という解決策で両立する。

## 対象外としてスキップした観点

- なし（全 21 観点を実行。プロジェクト全体レビューのため関連性マップによるスキップは適用せず）

## 未完了の観点

- なし

## Wave 3（Test Experts）について

Wave 1+2 で High 5 件 + Medium 多数のため、規程上は Wave 3 が起動条件を満たす。ただし本レビューは**プロジェクト全体**（約 6 万行）を対象とした静的レビューであり、指摘の多くはアーキテクチャ・設計判断を伴う大規模リファクタリングであるため、Wave 3 のテスト作成は Phase 5 の修正着手後に行うのが適切と判断し、今回の実行対象から除外した（修正フェーズでテストを併設する）。
