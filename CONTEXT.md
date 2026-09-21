# CONTEXT.md — ドメイン用語集

Yasumaro のドメイン言語。コード・ドキュメント・PBI はこの用語で書く。
スナップショットであり、最新の実装に合わせて更新する。

## 録画の流れ

| 用語 | 説明 | 主な所在 |
|------|------|---------|
| **録画パイプライン** | Service Worker 内で閲覧を1記録にまとめる step 列。判定 → 抽出 → プライバシー → 要約 → 保存の順 | `src/background/pipeline/` |
| **記録可否判定** | ドメインフィルタ・信頼・プライバシーヘッダ・権限による記録の可否決定。優先順位は一箇所に集約する | `src/background/pipeline/steps/check*Step.ts` |
| **コンテンツ抽出** | コンテンツスクリプトが本文候補をスコアリングし本文テキストを取り出す工程 | `src/utils/contentExtractor/` |
| **クレンジング** | 抽出前の DOM 要素除去。hard strip(無条件)と keyword strip(キーワード一致)がある | `src/utils/contentCleaner.ts` |
| **センテンスレベル冗長除去** | Jaccard 類似度で重複文を後着順に除去する工程(dedup) | `src/utils/contentDeduplicator.ts` |
| **デュアルペイロード** | クレンジング前の原文と後の本文を両方保持する診断機構 | `src/utils/contentExtractor/` |

## プライバシー

| 用語 | 説明 | 主な所在 |
|------|------|---------|
| **PII サニタイザ** | 個人情報を `[MASKED:種別]` にマスキングする工程。21 パターン | `src/utils/piiSanitizer.ts` |
| **プライバシーパイプライン** | 録画パイプライン中の PII マスキング step 群 | `src/background/pipeline/steps/processPrivacyPipelineStep.ts` |
| **ホワイトリスト判定** | クレンジング除外要素の判定。ダッシュボード設定と同一の判定を録画側も使う | `src/utils/contentExtractor/whitelistAdapters.ts` |

## テキスト処理コア

| 用語 | 説明 | 主な所在 |
|------|------|---------|
| **WASM コア** | `wasm/` 配下の Rust クレート。PII サニタイザ・TextRank・文冗長除去・タグ共起の計算主体 + `js-strings` 共有 lib。一覧の所有者は `wasm/crates.json` (`crates` + `libCrates`) | `wasm/pii-sanitizer/` `wasm/textrank/` `wasm/sentence-dedup/` `wasm/tag-cooccur/` `wasm/js-strings/` |
| **TS リファレンス** | WASM コアの移植元となる TypeScript 実装。フォールバックとパリティ検証の基準として残す | `src/utils/piiSanitizer.ts` ほか |
| **ハイブリッド** | WASM コア成功経路 + TS リファレンス フォールバックのラッパー。初期化不可・引数域外・実行時エラーで TS へ落ちる | `*Hybrid.ts` |
| **TextRank** | 文類似グラフ + PageRank で重要文を選ぶ L0 抽出圧縮 | `src/utils/sentenceExtractor.ts` |
| **保持インデックス契約** | WASM コアが「選択文のインデックス + 自身の split 総数」を返し、呼び出し側が同一 split で再構築する約束 | 各 `lib.rs` |

## AI 要約

| 用語 | 説明 | 主な所在 |
|------|------|---------|
| **AI プロバイダ** | OpenAI・Gemini・内蔵AI・ローカル推論など要約バックエンドの抽象。ProviderStrategy が共通フローを持つ | `src/background/ai/providers/` |
| **内蔵AI** | ブラウザ内蔵の要約機能。プロンプト適用と利用統計記録は全経路で契約 | `src/background/builtInAIClient.ts` |
| **カスタムプロンプト** | ユーザー定義の要約指示。全 AI 経路で適用される | `src/utils/customPromptUtils.ts` |
| **フォールバック AI サービス** | 利用可能なプロバイダへ順に落ちる選択器 | `src/background/ai/FallbackAIService.ts` |

## 保存と検索

| 用語 | 説明 | 主な所在 |
|------|------|---------|
| **オフスクリーン文書** | Service Worker が実行できない DOM 操作・SQLite 実行を担う隠し文書 | `src/offscreen/` |
| **SQLite 二次ストア** | wa-sqlite + FTS5 trigram によるローカル検索ストア。OPFS 永続化 | `src/offscreen/sqliteEngine.ts` |
| **OPFS ワーカー** | OPFS 同期ハンドルを握り SQLite を駆動する Worker | `entrypoints/opfs-worker.ts` |
| **ダッシュボード** | 履歴閲覧・設定の管理画面(options) | `src/dashboard/` |
| **ゲートウェイ** | ダッシュボード → Service Worker → オフスクリーンを繋ぐ RPC 窓口 | `src/background/sqlite/offscreenGateway.ts` |
| **アーカイブ** | 履歴行の退避操作群。1 op = 1 wire table 行 + 同期 assert で hop を導出 | `src/messaging/archiveWireTable.ts` |
| **暗号化バックアップ** | HMAC 鍵ストアと Web Crypto による設定・履歴の暗号化退避 | `src/utils/crypto/` |

## 信頼とセキュリティ

| 用語 | 説明 | 主な所在 |
|------|------|---------|
| **信頼ドメイン** | TrustChecker と trust db で管理するドメイン信頼状態 | `src/background/trust/` |
| **HMAC 鍵ストア** | バックアップ改ざん検知用鍵の保管 | `src/utils/crypto/hmacKeyStore.ts` |
| **CSP** | Manifest V3 の Content Security Policy。`wasm-unsafe-eval` は WASM コア実行に必要 | `wxt.config.ts` |
