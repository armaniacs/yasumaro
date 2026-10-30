# ROADMAP ― 追加する機能・追加しない機能

最終更新: 2026-10-31（v6.9.63 時点）

この文書は、Yasumaro の**将来追加する機能（TODO）と追加しない機能（NOT-TODO）だけ**を扱う。

- 内部リファクタリング・性能・テスト基盤など非機能の優先度は [pbi/00-INDEX.md](pbi/00-INDEX.md) と見送り・トリガー付き候補の統合台帳 [pbi/2026-09-05-00-backlog-future.md](pbi/2026-09-05-00-backlog-future.md) が正。この文書では扱わない
- 機能の実行も既存の PBI フロー（`pbi/YYYY-MM-DD-NN-type-slug.md` + RICE 採点 + validate ゲート）に乗る。この文書は方向と判断基準だけを置く
- 機能の提案が来たときは、まず「判断の軸」と NOT-TODO と突き合わせる。その後で TODO か、条件付きか、却下かを裁定する

---

## 判断の軸

すべての TODO / NOT-TODO は次の 5 軸から導く。軸の変更は ADR 相当の記録を残す。

1. **個人利用が最優先** ― 自分が毎日使う道具である。外部ユーザーは歓迎するが、機能追加の最終判定は「自分が毎週使うか」。自分のワークフローを壊す変更はしない
2. **ローカルファースト** ― 記録・検索・分析は端末内で完結する。外部送信は、ユーザーが明示的に設定した宛先（AI プロバイダ / Obsidian Local REST API / GitHub Gist）に限る
3. **収集を増やさない** ― 新しいデータストリームの追加より、既に集めたデータの価値を上げる。収集の拡大は審査リスク・PII リスク・保守コストの 3 つを同時に増やす
4. **ストア審査との整合** ― 閲覧履歴の収集は [CWS の例外条項](https://developer.chrome.com/docs/webstore/program-policies/limited-use)（ストアページと UI で目立つ形に説明したユーザー向け機能の場合のみ許容）の上に立つ。開示文と機能は常に同期させる
5. **保守は個人規模** ― サーバー・アカウント・常駐プロセスなど、恒常的な運用コストを生む仕組みを持ち込まない

参照: 差別化の相手方である Obsidian Web Clipper は「ユーザーアクション起点・明示的保存・ローカルファイル」に集中し、受動的監視と AI 要約をやらない（[obsidian.md/clipper](https://obsidian.md/clipper)）。Yasumaro の差別化は受動的記録 + 構造化された検索可能な履歴 + ユーザー自身のキーによる AI 要約にある。リスクも同じ場所に集中する。

---

## TODO（追加を予定している機能テーマ）

### T1. コア記録ループの信頼性維持（常設・最優先）

- 内容: 判定 → 抽出 → プライバシー → 要約 → 保存の毎日のループを壊さない。MV3 の制約（[service worker の寿命](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、[alarms 最小 30 秒](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)）は仕様として受け入れ、滞在時間・スクロール深度は content script 側で計測し、書き込みはバッチ/アラーム駆動に寄せる現設計を維持する
- 判断基準: このループに触れる変更は最優先でレビューする。回帰は validate ゲートで止める。記録の欠落・重複・保存先の混乱はいかなる新機能より優先して直す

### T2. 内蔵 AI の追従と強化（Prompt API / Summarizer API）

- 現状: Prompt API（`LanguageModel`）を Service Worker から直接呼ぶ実装は済んでいる（[builtInAIClient.ts](src/background/builtInAIClient.ts)、Built-in AI はベータ）。Summarizer / Translator API は Chrome 138 で stable、Prompt API は拡張機能限定で stable（[公式ステータス](https://developer.chrome.com/docs/ai/built-in-apis)）
- TODO: Summarizer API（要約ユースケースに特化した公式 API）の採用評価。stable 版の挙動追従。availability の環境差（Edge の Phi-mini、モデル DL 要件）への追従
- 判断基準: 「API キー不要・オフライン・ページ内容を外部送信しない」という内蔵 AI の利点を強める変更だけ採用する。Firefox では外部プロバイダのまま（内蔵 AI 非対応を README に明記済み）。非対応環境へのフォールバックを壊す変更はしない

### T3. 既存データの価値向上（検索・振り返り・分析の仕上げ）

- 現状: FTS5 trigram による日本語検索、履歴アーカイブ、エクスポート/インポート、分析パネル（ヒートマップ、タグクラスタ、リサーチセッション、再訪/タイムカプセル）は実装済み。週次/月次レビューサマリも実装済み（[reviewSummaryGenerator.ts](src/background/reviewSummaryGenerator.ts)）
- TODO: 台帳送りの分析候補（スター分析、記録量・ストリーク、AI 利用統計、遷移データの削除ボタンなど）は RICE 順に消化。遷移データの削除ボタンはユーザー要望時、手動保存でも遷移を記録するかは利用実態確認後（[メタ認知台帳](dev-docs/archived/pbi/2026-09-26-00-backlog-metacognition-analytics.md)）
- 判断基準: 新規分析は「既に集めているデータだけで答えられる質問」に限る。収集の追加を伴う分析は NOT-TODO（N3/N11）。タグ設定なしでも使える（キーワードクラスタ等）を維持する

### T4. 既存 UI と実装のギャップの裁定（パス許可）

- 現状: プライベートページ確認ダイアログは「パス許可」の選択肢を提示するが、実装はホスト名に正規化され、パス単位マッチングは未実装（[whitelistWriter.ts](src/popup/whitelistWriter.ts)、[DESIGN_SPECIFICATIONS.md 13.5](dev-docs/DESIGN_SPECIFICATIONS.md)）
- TODO: パス単位マッチングを実装するか、UI の選択肢を「ドメイン許可」に統一するかを裁定し、UI と実装を一致させる。どちらを選ぶ場合も README と PRIVACY.md の記述を同期させる

### T5. 開示・ポリシー整合の運用（常設チェックリスト）

- 内容: 機能追加が収集・送信・権限に触れる場合、次を同時更新する: `public/PRIVACY.md` と `docs/PRIVACY.md`（同一内容必須）、ストア説明、初回同意フロー、[PERMISSIONS.md](PERMISSIONS.md)、監査ログの説明。[CWS の開示要件](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)（インストール前の目立つ開示 + informed consent）と [権限ポリシー](https://developer.chrome.com/docs/webstore/program-policies/permissions)（narrowest permissions、future-proof 要求の禁止）に照らして確認する
- 判断基準: 「開示を更新しないまま収集や送信を変える」を禁止する。API キーはユーザー提供・ストア非送信の現設計を維持（[公式 AI ガイダンス](https://developer.chrome.com/docs/extensions/ai)と整合）

### T6. プラットフォーム追従（日付・トリガーゲートの消費）

- 内容: 既にゲートが確定しているものは pbi の日付・トリガーどおりに消費する。主なもの: wa-sqlite レガシーのサンセット（[pbi/2026-09-05-32](pbi/2026-09-05-32-refactor-wasqlite-sunset.md)、2026-12-17 以降 + 診断パネル報告ゼロ）、TypeScript 7 採用（[typescript-eslint 対応待ち](pbi/2026-09-26-12-backlog-typescript-7-adoption.md)）、Stryker runner 採用（[上流修正待ち](pbi/2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md)）、deprecated プロバイダ（`OpenAIProvider` / `ProviderStrategy`）の再評価（2026-12-31）
- 判断基準: 新規にゲートを増やさない。既存ゲートの条件変更は、その理由を pbi に記録してから行う

---

## NOT-TODO（追加しない機能）

### 恒久 ― やらない。再開条件は「この文書の軸そのものが変わった時」のみ

| # | やらないこと | 理由 |
|---|---|---|
| N1 | 自前のサーバー・アカウント・クラウド同期基盤 | 個人規模で恒常運用コストを払えない。アカウント体系は Limited Use と開示の負担を恒久化する。ローカルファーストが差別化そのもの。同期が必要ならユーザー所有ストレージ（Gist の現設計）で足りる |
| N2 | チーム共有モード（共有 Vault 経由の複数人利用） | 認証・権限管理・共有運用は別製品の要件。チーム向けに方向転換するなら、それは新しいプロジェクトとして判断する（拡張アイデア E4） |
| N3 | 収集データストリームの拡大（スクリーンショット、フォーム入力、ページ全 DOM、操作イベントの追跡、常時録画） | プライバシー姿勢の崩壊と PII リスクの急増。審査上も「目立つ説明」との整合が困難になる。使わないデータを集める保守コストは個人規模で払い続けられない |
| N4 | 遠隔テレメトリ・利用統計の送信（匿名でも） | テレメトリなし製品という建前と監査ログ設計（7 日間保持の端末内ログ）の整合が崩れる。診断は端末内の診断パネルで完結させ続ける |
| N5 | `tabs` / `history` 権限の追加 | [ADR 2026-10-07](dev-docs/ADR/2026-10-07-tab-url-permission-decision.md) で案 A を却下済み。install ダイアログに「閲覧履歴の読み取り」が新規表示され、端末内で完結する privacy posture と矛盾する。再評価条件（badge の URL 由来が必須機能になった場合）は ADR に記録済み |
| N6 | 未実装機能のための先行権限追加 | [CWS 権限ポリシー](https://developer.chrome.com/docs/webstore/program-policies/permissions)が future-proof な権限要求を明確に禁止している。実装してから権限を要求する |
| N7 | API キーのストア送信・自前プロキシサーバー | [CWS AI ガイダンス](https://developer.chrome.com/docs/extensions/ai)は「キーをストアと共有しない・ユーザーに提供させる」ことを求める。プロキシはサーバー運用を恒久化する（N1 と同型）。BYO-key の現設計が正 |
| N8 | キーボード操作対応（コマンドパレット・ショートカットの拡充） | [ADR 2026-04-19](dev-docs/ADR/2026-04-19-no-keyboard-operation-support.md) の決定（2026-10-23 に記録入口のショートカット `Alt+Shift+Y` だけ部分更新済み）。記録判定は「滞在 + スクロール」であり、コマンドパレット等キーボード起点の全面操作と本質が合わない。再評価条件は ADR に記録 |
| N9 | SQLite バックエンドの動的切替機構（実行中の backend 差し替え UI） | [ADR 2026-07-13](dev-docs/ADR/2026-07-13-sqlite-architecture-deep-dig.md) 決定 3。OPFS Worker 初期化失敗は環境要因でセッション中に変化せず、切替は DB 移行とデータ不整合を引き起こす。one-shot で選び、選び直しは移行機能として作る |
| N10 | 埋め込みベクトルによる類似記事デデュープ・セマンティック検索 | [sentence-dedup WASM の不採用確定](pbi/00-INDEX.md)と同型の問題: 実測された利得が小さく、コンテンツスクリプト経路の CSP 制約で WASM/重いランタイムの初期化を保証できず、バンドルと複雑性のコストは大。類似・ループ検出はキーワード単位（実装済み + 台帳残置）で段階的に足りる（拡張アイデア E6） |
| N11 | scroll_ratio / visit_duration 依存の新規表示・フィルタの追加（読み切り率、熟読度フィルター） | [メタ認知台帳の不採用裁定](dev-docs/archived/pbi/2026-09-26-00-backlog-metacognition-analytics.md)。読みかけリマインダー（積読通知相当）は 6.9.63 で出荷済みのため対象から外し、新規行の `visit_duration` / `scroll_ratio` が常に NULL だった根拠も pickRecordDiagnostics 受渡し欠落の修正（6.9.63）で解消済み。残る対象は可視区間の累積計時がまだ記録経路に配線されていないため引き続き見送り（滞在時間パネル撤去（`54cfab5e`）の判断とも両立）。再開条件は「可視区間の累積計時が記録経路に配線されたとき」（変更なし）。更新理由（2026-10-31 再同期）: 出荷済みの読みかけリマインダーと NULL 前提の解消を行に反映した |
| N12 | Safari / モバイル（Android・iOS）対応 | 個人利用はデスクトップ Chromium。移植コスト（API 差分、署名、審査、offscreen/OPFS の代替実装）が利得を大きく上回る。OPFS 非対応端末へのストレージフォールバックは既にあるが、拡張 UI としてのモバイル最適化はしない |
| N13 | read-it-later 化・ノート内編集機能（後で読むための保存・編集フロー） | 記録特化のアイデンティティを曇らせるスコープ肥大。読みかけの気づきはリマインダー（6.9.63 出荷）で賄い、Pocket / Obsidian 相当の保存・編集は別製品の要件。2026-10-31 のやること/やらないこと設計報告書（`docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md`）の候補 5 を裁定 |
| N14 | チャットアシスタント化の拡張（履歴への対話 UI） | 「履歴に聞く」で足りる。AI ブラウザと正面衝突する領域。Chrome 側の AI 履歴機能の進展は P2 の監視に乗せる。2026-10-31 のやること/やらないこと設計報告書（`docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md`）の候補 6 を裁定 |
| N15 | Web Clipper 的なテンプレート保存（型付きテンプレート・サイト別テンプレート） | 記録とクリップは別物。選択範囲の記録（[pbi/2026-10-31-03](pbi/2026-10-31-03-feat-selection-capture-recording.md)）で近い需要は吸収する。テンプレート保存は Obsidian Web Clipper の競合領域なので目指さない。2026-10-31 のやること/やらないこと設計報告書（`docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md`）の候補 8 を裁定 |

### 条件付き ― 今はしない。条件が揃えば再評価する

| # | 今はしないこと | 再評価条件 |
|---|---|---|
| C1 | Firefox の本格対応（レビュー網羅、署名ビルド、常駐設計の再構成） | 自分が Firefox を主ブラウザにした時。現状は [AMO 公開済み](pbi/00-INDEX.md)の実験的サポートで維持。本格化には event page 前提の再設計が必要（[MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts)） |
| C2 | 新規同期先の追加（Gist 以外のクラウドストレージ） | 個人的必要性 + 対象ごとの opt-in + 開示の同期 + ユーザー所有ストレージであることの 4 条件が揃った時。既定 ON の外部送信は恒久 NOT-TODO として扱う（N1/N3/N4）。更新理由（2026-10-31 再同期）: Webhook 連携は出荷済み（[PBI 2026-10-22-05](dev-docs/archived/pbi/2026-10-22-05-feat-webhook-export.md)、6.9.62/63。条件・履歴/冪等再送・オプション UI 第 29 パネル）のため行から除外した。出荷済みの Webhook は軸 2 の「ユーザーが明示的に設定した宛先」に該当する |
| C3 | 新規 AI プロバイダの追加 | 内蔵 AI とローカル LLM で代替できない個人的必要性が出た時。着手前に host_permissions 列挙・provider catalog 残債・審査更新のコストを見積もる。追加のたびに「provider catalog 残債」トリガーが発火する（[backlog-future 台帳](pbi/2026-09-05-00-backlog-future.md)） |
| C4 | 外部カレンダー連携（会議・予定の文脈付与） | 権限コストを上回る個人的必要性が出た時。既定ではしない（拡張アイデア E3） |
| C5 | タグ共起グラフの高度な探索 UI | 実使用の摩擦が具体的に報告された時（拡張アイデア E2）。現状はタグ共起パネルが既存で、不足は未確認。更新理由（2026-10-31 再同期）: セッション再生パネル（panel-session-timeline）と読みかけリマインダーの SW 配線は 6.9.63 で出荷済みのため、タイムライン再生ビュー（E5）を行から除外した |
| C6 | Obsidian 公式 CLI 経由の書き込み | Obsidian Local REST API が使えなくなった時の代替として評価（[obsidian.md/help/cli](https://obsidian.md/help/cli)）。現設計が壊れるまで作らない |
| C7 | IDB 中間層の廃止（Option B） | fallback-only 到達率の測定後。未測定のまま決定することは禁止（[backlog-future 台帳](pbi/2026-09-05-00-backlog-future.md)、プライバシー制約下の計測設計が先） |
| C8 | popup / settingsScreen の復活 | 製品判断が出た時（デッドコードは削除済み、戻す場合は新規実装） |

### プラットフォームに任せるもの ― 自前実装しない・監視対象

| # | 監視対象 | 方針 |
|---|---|---|
| P1 | 単発ページ要約のモデル品質 | [Summarizer API](https://developer.chrome.com/docs/ai/built-in-apis) 等が進化する領域。自前のクレンジング/PII 前処理は維持しつつ、要約品質の追い込み（プロンプト調整の拡大、評価基盤の構築）はしない |
| P2 | ブラウザ側の履歴検索・AI 履歴機能 | Chrome 標準が進んだ領域は自前機能の重複分を縮小する方向で再評価する。ローカル SQLite + FTS5 による構造化履歴の蓄積・検索は内蔵機能では代替されない（差別化の根幣） |

---

## 2026-09-22 拡張アイデア集（E1-E8）の裁定

[dev-docs/2026-09-22-yasumaro-usage-and-extension-ideas.md](dev-docs/2026-09-22-yasumaro-usage-and-extension-ideas.md) の 8 案は、この文書作成時点まで採点・裁定の記録がなかった。ここで初めて裁定する。

| # | アイデア | 裁定 | 理由・根拠 |
|---|---|---|---|
| E1 | 要約の要約（メタ要約）バッチジョブ | **既に実装済み** | 週次/月次レビューサマリは [reviewSummaryGenerator.ts](src/background/reviewSummaryGenerator.ts) + alarmRegistry で動作済み。追加拡張（プロジェクト単位の集計など）は T3 の台帳候補として RICE 採点の上で扱う |
| E2 | タグ共起グラフのインタラクティブ探索 UI | 条件付き（C5） | ノードクリックのフィルタ等は既存。追加は実使用の摩擦が報告されてから |
| E3 | 外部カレンダー連携による文脈付与 | 条件付き（C4・低優先） | 新規のセンシティブ権限と送信経路を要する。個人利用で必要性が確認されていない |
| E4 | チーム共有モード | 恒久 NOT-TODO（N2） | 別製品の要件。軸の変更時にのみ再判断 |
| E5 | ブラウジングセッションのタイムライン再生ビュー | **既に実装済み** | 読みかけ復元パネル（panel-session-timeline）と読みかけリマインダーの SW 配線は 6.9.63 で出荷済み。更新理由（2026-10-31 再同期）: 出荷済みの機能を条件付きのまま残すと次の提案裁定を誤らせるため裁定を更新した |
| E6 | 埋め込みベクトルによる類似記事デデュープ | 恒久 NOT-TODO（N10） | 利得が小さくコストが大（sentence-dedup WASM の実測と同型）。キーワード単位のループ検出は実装済み + 台帳残置 |
| E7 | 外部ツールへの Webhook/エクスポート連携 | **既に実装済み** | Webhook エクスポート（条件・履歴/冪等再送・保存時発火・オプション UI 第 29 パネル）は 6.9.62/63 で出荷済み（[PBI 2026-10-22-05](dev-docs/archived/pbi/2026-10-22-05-feat-webhook-export.md)）。既定 ON の自動転送はしない方針は宣言済み host_permissions ゲートと未宣言 origin fail-closed で実装済み。更新理由（2026-10-31 再同期）: 出荷済みの機能を条件付きのまま残すと次の提案裁定を誤らせるため裁定を更新した |
| E8 | 閲覧行動に基づくリマインダー/フォローアップ提案 | **既に実装済み** | 読みかけリマインダーの SW 配線（通知 ID 厳密解析・私物拒否・Daily Note TODO 追記）は 6.9.63 で出荷済み。前提だった `scroll_ratio` 常時 NULL も pickRecordDiagnostics 受渡し欠落の修正（6.9.63）で解消済み。更新理由（2026-10-31 再同期）: 出荷済みの機能を恒久 NOT-TODO のまま残すと次の提案裁定を誤らせるため裁定を更新した |

---

## 運用

- 機能提案は、まず「判断の軸」と NOT-TODO に照らして裁定してから、TODO なら PBI 化する（`pbi/YYYY-MM-DD-NN-type-slug.md` + RICE）
- NOT-TODO の恒久項目は、その理由が消えた時だけ ADR を書いて再評価する。理由が残る限り再評価しない
- 条件付き項目の条件が発火したら、その行を TODO 側に昇格させ、この文書を更新する
- この文書自体の見直しは半年ごと（次回 2027-04 頃）、または軸の変更時に行う
- 検討記録（2026-10-31）: 半年ごとの見直しはリリースペース（2 週間で 15 版）に対して粗く、ROADMAP が出荷済み機能と乖離するリスクが実際起きた（今回の C2/C5/N11 の再同期）。対処として、リリース時に CHANGELOG を更新する際に「その版の出荷内容がこの文書の TODO/NOT-TODO 行と矛盾しないか」を確認する手順を運用に加える。チェックのスクリプト化はしない（軸 5）。矛盾が生じた行は「行の理由が消えた時だけ更新する」方針に従い、その時点で更新する
- 見送り・トリガー付きの非機能候補は [pbi/2026-09-05-00-backlog-future.md](pbi/2026-09-05-00-backlog-future.md) に引き続き置く（この文書とは重複させない）
