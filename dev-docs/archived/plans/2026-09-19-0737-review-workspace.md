# Checking Team レビュー報告 — ワークスペース全量（main HEAD）

- 実行日: 2026-09-19
- 対象: ワークスペース全体（差分なしのため全量レビュー、約2866ファイル）
- 実行方式: 逐次（サブエージェント起動手段が利用不可だったためフォールバック）
- graphify: 利用可能（graph.json あり、god nodes・コミュニティ構造を参照）

## 総合評価: 82/100 (ランク: A)

観点別スコア（実行21観点の平均。Edge & Mobile のみ対象外で除外）:

| 観点 | スコア |
|------|-------|
| Red Team Leader | 75 |
| Blue Team Leader | 85 |
| System Architect | 82 |
| Maintainability Guardian | 78 |
| Legacy Bridge Architect | 88 |
| UI Expert | 84 |
| Accessibility Advocate | 88 |
| i18n Expert | 90 |
| Documentation Architect | 86 |
| Tuning Expert | 86 |
| SRE/Ops Specialist | 84 |
| FinOps Consultant | 90 |
| Compliance & Privacy Guard | 87 |
| Ethics & Bias Auditor | 92 |
| Supply Chain & Dependency Sentinel | 88 |
| API & Contract Negotiator | 90 |
| Domain Logic Expert | 87 |
| Data Integrity Expert | 89 |
| Refactoring Evangelist | 83 |
| DX Advocate | 91 |

## 重要指摘事項（優先度順）

### [High] cleansingOffscreen.ts の innerHTML シンクにサイズ上限がなくDoS/XSS波及の余地
- 指摘者: Red Team Leader
- 場所: src/offscreen/cleansingOffscreen.ts:53-57,69-71
- 影響: payload の html は string 型チェックのみでサイズ上限なし。巨大文字列で DOMParser が Offscreen を長時間占有し応答不能になる。フォールバック経路の container.innerHTML = html は外部HTMLを実 document に流し込む
- 対処: payload html に上限（例: 512KB）を設け超過時は success:false で拒否。フォールバック経路を廃止し DOMParser 必須化を検討

### [Medium] 🎯 バージョン欠落メッセージの無条件受け入れがダウングレード攻撃面になる
- 指摘者: Blue Team Leader、Legacy Bridge Architect（Low 側から補足）
- 場所: src/background/handlers/envelopePolicy.ts:56-58
- 影響: protocol version フィールドなしの legacy sender をそのまま受け入れ、バージョン強制が実質無効化される。古い content script 残存環境で旧経路が使われ続ける
- 対処: absent を deprecated 扱いに格下げし警告ログ＋集計カウンタを付け、移行進捗を可視化する

### [Medium] popup の innerHTML 連鎖は escapeHtml 依存で単一障害点
- 指摘者: Red Team Leader、UI Expert（Low: クリア直書きの散在も同根）
- 場所: src/popup/statusPanel.ts:110,129,182-184,247-283,296 / src/popup/pendingPages.ts:36 / src/privacy/privacy.ts:187
- 影響: render*Html＋esc の組み合わせで安全性を担保しているが、将来の描画追加時の esc 漏れ1か所で stored XSS になる
- 対処: render 系の textContent ベース構築への段階移行、または esc 適用の静的検査（grep CI）強制。clearElement ヘルパーへの一本化

### [Medium] AI Provider の APIキー取得フォールバックがキーの出所を曖昧にする
- 指摘者: Red Team Leader
- 場所: src/background/ai/providers/OpenAIProvider.ts:49-69 / src/background/ai/providers/GeminiProvider.ts:45-48
- 影響: apiKeyKey → `${name}_api_key` → DEFAULT の無言フォールバックで、誤スコープのキー混入やローテーション時の取り違えにつながる
- 対処: 解決したキー出所を診断出力に記録し、DEFAULT への無言フォールバックをやめる

### [Medium] 🎯 MessageRouter 周辺への依存集中と dashboardSqlite ハンドラ群の肥大
- 指摘者: System Architect
- 場所: src/background/handlers/MessageRouter.ts / src/background/handlers/dashboardSqlite/
- 影響: god node への依存集中。新規 message type 追加時に委譲層と実処理層の両方を触る必要があり、境界の侵食が進行中
- 対処: dashboardSqliteHandlers.ts を薄い委譲層にし、実処理は dashboardSqlite/ 配下へ完全移譲。新規分岐は deps.ts 経由の依存注入を必須化

### [Medium] Offscreen 輸送層の二重実装の切り替え条件が暗黙的
- 指摘者: System Architect
- 場所: src/background/ChromeOffscreenTransport.ts / src/background/InPageOffscreenTransport.ts
- 影響: 実行時にどちらの Transport が選ばれるか呼び出し側から見えず、障害時の切り分けが困難
- 対処: createBackgroundServices.ts で選択結果を起動ログに記録し、診断出力に transport 名を含める

### [Medium] HTML エスケープ・サニタイズ関数の分散
- 指摘者: Maintainability Guardian
- 場所: src/utils/htmlEscape.ts / src/utils/markdownSanitizer.ts / src/popup/domUtils.ts / src/popup/errorUtils.ts
- 影響: 同一責務が4か所以上に分散し、呼び出し側が選択を誤りやすい。上記 innerHTML 指摘の構造的原因
- 対処: htmlEscape.ts を正本に一本化し、他は再export の互換層に。使い分け表を AGENTS.md に追記

### [Medium] 巨大ファイルの単一責任逸脱
- 指摘者: Maintainability Guardian
- 場所: src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts（993行）/ src/dashboard/panels/diagnostic/diagnosticsPanel.ts（688行）/ src/offscreen/queryPlan.ts（637行）
- 影響: View・Model・配線の混在で変更影響の局所化が崩れ、テストが書きづらい
- 対処: View／Model／配線に3分割。少なくとも query 組み立てを Model 側へ寄せる

### [Medium] .then() 残存によるエラーハンドリング様式の二重化と失敗の握りつぶし
- 指摘者: Blue Team Leader、SRE/Ops Specialist、Refactoring Evangelist、System Architect（Low 補足）
- 場所: src/background/headerDetector.ts:166-169 / src/background/compositionManifest.ts:174 / src/utils/storage/storageTransaction.ts:35-38 他約15か所
- 影響: 規約（async/await のみ）との乖離。headerDetector は .catch がなく storage.session.set 失敗を検知できず、プライバシー判定欠落の運用リスクになる。意図的なキュー連鎖と単なる残存の区別もつかない
- 対処: 意図的な連鎖には意図コメントを付け、それ以外は async/await＋try-catch に置換。最低でも headerDetector に .catch を追加

### [Medium] statusPanel の描画関数群が単一ファイルに集中
- 指摘者: UI Expert
- 場所: src/popup/statusPanel.ts
- 影響: cleansing/trust/domain/privacy/cache の各描画が同居し、statusRenderers.ts との責務分界が曖昧
- 対処: 種別ごとの render を statusRenderers.ts へ完全移譲し、statusPanel.ts は調停のみに

### [Medium] 🎯 ProviderStrategy の旧名エイリアスと旧クラスが無期限に残存
- 指摘者: Legacy Bridge Architect
- 場所: src/background/ai/providers/ProviderStrategy.ts:548 / src/background/ai/providers/OpenAIProvider.ts:239
- 影響: 旧名のまま新規コードが書かれると移行が終わらず、破壊的変更時の影響見積もりが曖昧になる
- 対処: 新規コードでの旧名 import を lint 禁止にし、@deprecated に sunset 日を明記

### [Medium] 🎯 Obsidian 連携の http 許容が平文での履歴データ送信を可能にする
- 指摘者: Compliance & Privacy Guard
- 場所: src/background/obsidianClient.ts:92
- 影響: 閲覧履歴・AI要約を平文 http で送信できる設定が可能。localhost は実害小だが LAN 内他ホスト宛は盗聴リスク
- 対処: localhost/127.0.0.1 以外の http を警告またはブロックし、設定UIに明示

### [Medium] 記録可否判定の分散
- 指摘者: Domain Logic Expert
- 場所: src/background/recordingTriggerManager.ts / src/background/headerDetector.ts / domainFilter 関連
- 影響: 同一判定が3経路に分散し、優先順位・競合時の挙動が読み取りづらい。headerDetector 失敗時の黙殺と組み合わさると誤記録・記録漏れの倒れ方が予測困難
- 対処: 優先順位表を1か所に集約し、各判定を純粋関数化して組み合わせテストで網羅

### [Low] エラーレスポンスの情報量（Blue）、alarm 名フォールバック（SRE）、コスト可視化なし（FinOps）、AI要約の免責不足（Ethics）、overrides 理由不明（Supply Chain）、プロトコルバージョン未文書化（API）、storage キー追加手順の暗黙性（Legacy）、quota 超過時の縮退不透明（Data Integrity）、マジックナンバー残存（Refactoring）、テストコマンド使い分け不明（DX）、aria-live 不足（A11y）、コメント日本語残存（i18n）、dev-docs 肥大（Docs）、debounce 固定値（Tuning）、@deprecated 棚上げ（Maintainability）、popup クリア直書き（UI）、非同期様式不統一（System Architect Low）、同意再確認フロー弱さ（Compliance Low）
- 指摘者: 各観点（詳細は .checking-team-tmp/main-20260919-073741/*.md）
- 影響: いずれも即時リスクなし。改善提案として記録
- 対処: 各結果ファイルの対処欄を参照

## コンフリクト調整結果
相反する指摘なし。System Architect は他観点の指摘（innerHTML 連鎖、.then() 残存）を支持。Blue Team の absent 受け入れ指摘と Legacy Bridge の移行完了可視化は同一根で統合済み。

## コードベース構造の知見（graphify）
- MessageRouter・sqliteHistoryModel・offscreenGateway・obsidianClient・crypto/index.ts は god node であり、変更時は影響範囲見積もりを必須とする
- handlers/ 配下は envelopePolicy／senderTrust／種別別ハンドラに分割され単方向依存で良好。dashboardSqlite 配下のみ二重化の兆しあり
- Offscreen から chrome.tabs/downloads/action 系 API の直接利用なし。SW ブリッジ分離は守られている
- service-worker.ts にモジュールスコープ可変状態なし。エフェメラル制約に適合
- storage（Port/Repository/Transaction）と message envelope（型＋VALID_MESSAGE_TYPES 二重整合性テスト）の守りが厚く、データ・プロトコル層の信頼性が高い

## 対象外としてスキップした観点
Edge & Mobile Strategist（Chrome デスクトップ拡張でありモバイル・PWA 観点は該当なし）

## 未完了の観点
なし（全21観点の結果ファイルあり。Wave 3 は High 1件＋Medium 12件＝13件のため本来実行対象だが、本レビューは全量レビューであり自動修正は適用見送りとした。理由は次節）

## 自動修正の見送りについて
Phase 5 の自動修正は適用していない。全量レビューで指摘が13件・複数 god node にまたがるため、無優先順位の一括修正は回帰リスクが高い。High 1件（cleansingOffscreen の上限）から個別に対処することを推奨する。
