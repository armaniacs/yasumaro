# PBI: 履歴エントリからの AI要約再生成（クレンジング緩和つき）

## ユーザーストーリー
ダッシュボードの閲覧履歴を使う利用者として、AI要約が「個人および法人に関する内容です。」のように役に立たない短い結果になったレコードに「AI要約を作り直す」ボタンを押したい、なぜならクレンジング/抽出で送信内容が実質空（実例: 30.6 KB → 193 B、99.4% 削減）になり要約の価値が失われるから。その際はクレンジングをやや緩めた状態で再送してほしい。

## 優先度
- RICEスコア: 0.96（Reach=3 / Impact=2 / Confidence=0.8 / Effort=5）
- 根拠: 過剰クレンジングはサイト構造次第で誰にでも起き、発生時はレコードが実質無価値になる（Impact 高め）。ユーザー明示要求のため Confidence 高。ただし到達は「過剰クレンジング経験者 + 手動操作」に限られるため Reach は中。Effort は新メッセージ + パイプライン保存分岐 + UI + i18n + e2e で 5。
- 種別: ✨機能追加（feat）
- 難易度: 🔴高（8 SP 目安）
- 副作用: 🔴あり（recording パイプラインの保存ステップに UPDATE 分岐を追加する。通常記録経路を byte-identical で壊さない設計が必須。AI API コストも増える）

## 背景（2026-09-22 時点の現状）

### 過剰クレンジングの実例
- 対象: `https://qa.smbc.co.jp/faq/show/7622?site_domain=default`（三井住友銀行 FAQ）
- 受信要約: 「個人および法人に関する内容です。」（送信 194 トークン / 受信 13 トークン）

診断行の実測値と行の計測対応（2026-09-22 コード照合済み）:

| 診断行 | 計測対象 | 実測値 | 実行順での位置 |
|---|---|---|---|
| コンテンツ抽出 | `page_bytes` → `candidate_bytes` | 30.6 KB → 193 B（99.4% 削減） | ①候補選択 `findMainContentCandidates` |
| Content Cleansing | `original_bytes` → `cleansed_bytes` | 193 B → 193 B（**0%**） | ②クローン削除 `cleanseContent` |
| AI要約クレンジング | `ai_summary_*` | 計測なし | ③`cleanseAISummaryContent` |

- 含意: **削減の主因は①候補選択**（`page_bytes` → `candidate_bytes`）。Content Cleansing 段はこのレコードでは削除ゼロ。実行順は `CLEANSING_ORDER.md` と `contentExtractor/index.ts` で確認済み（`cleanseContent` の唯一の呼び出しは候補選択後のクローン `index.ts:249`、②は①より後）。実装前にこの URL で再現確認する。**本件の改善経路は PBI 05 のガード（① body path フォールバック）** — cleanseMode（③ルール段下げ）は本件の主因には効かない（Ask 2026-09-22 確定）。
- 「AI要約クレンジング: 計測なし」は (a) AI要約クレンジング未実行、(b) `applyFallback` の short_content 復元が AI 計測を破棄（`settleFallback` が `aiSummary*` を undefined 化）— のどちらでもあり得る。再現確認で切り分ける。
- 削減ガード全体の設計課題（Content Cleansing / 候補選択にガード不在、過剰削減FBの発火が AI要約クレンジング依存）は予防側 PBI [2026-09-22-05-feat-extraction-overcut-guards.md](2026-09-22-05-feat-extraction-overcut-guards.md) へ分離。本 PBI は治療（手動再生成）に専念する。

### 保存データと再生成の制約
- エントリが持つのは `content`（AIに送信済みの後段データ）と `summary`（受信要約）、およびバイト統計のみ。**クレンジング前の元HTMLは保存されていない** → 再生成にはページの再取得が必須。送信済み `content`（193 B）を再送しても同じ結果になる。
- エントリ表示: `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts`（`buildEntryListHtml` のヘッダーに checkbox / star / title / copy / ✕ が並ぶ。スクリーンショットの丸印位置は title と ✕ の間付近）
- 診断行・進捗バー: 同ファイルの funnel 行 + `historyEntryPresentation.ts`（欠測時は reason 表示。PBI 2026-09-18-21）

### 既存経路と再利用可否
| 経路 | 再利用可否 |
|------|-----------|
| `MANUAL_RECORD`（`recordingHandlers.ts` + `ManualContentFetcher`） | **非推奨**（再取得のみ流用可）。source policy `'manual'` は `skipDuplicateCheck: true` で **新規 INSERT** するため同じ URL が2件になる。さらに ManualContentFetcher は抽出パイプラインを通らないため `cleanseMode` が無効（推奨構造 3 参照）→ update-in-place + GET_CONTENT 経路が別途必要 |
| GET_CONTENT（`getContentHandler.ts` → `extractAndCommit(config?)`） | **推奨**。`extractAndCommit` は既に optional `CleansingConfig` を受け取るが handler 側が未伝播 — override payload 追加で抽出/Content Cleansing/AI要約クレンジングを緩和設定で再実行でき、byte 統計も揃う |
| dashboard `update` subtype（`dashboardSqliteProtocol.ts`） | `DASHBOARD_MUTABLE_SUBSET` は 10 フィールドのみ（`summary` は可、`content` / byte統計 / tokens は**不可**。`dashboardMutableSubset.test.ts` が意図的狭さを pin）→ 拡張ではなく background 専用経路を使う |
| `recordPendingPage` ゲートウェイ（`pendingRecordGateway.ts`） | envelope（protocolVersion）+ 20秒タイムアウト + レスポンス正規化の雛形として流用可 |
| クレンジング緩和の資産 | `PRESETS`（minimal 3 ON / balanced 9 ON / aggressive 25 ON、`src/utils/aiSummaryCleaner/presets.ts`）、per-site override、fallback ratio/min bytes 設定 |
| テスト資産 | `testDir/e2e/test-pages/over-cleansed-page.html`、`testDir/e2e/cleansing-preview-confirm.spec.ts` |

### 既実装確認（フェーズ0、2026-09-22 実施）
- `rg -n "regenerate|再生成|作り直し|再要約" src/` → 機能としての一致なし（暗号鍵再生成などの無関係な match のみ）
- `MANUAL_RECORD` / pending 再記録は「新規レコード追加」であり、既存レコードの要約を差し替える経路は存在しない
- 結論: **未実装**。本 PBI は新規機能として成立する

## BDD受け入れシナリオ

```gherkin
Scenario: 過過剰クレンジング済みレコードを緩和モードで再生成する
  Given PBI 05 の過剰削減ガードが導入済みである（実装順: 05 先行 — Why 連鎖K）
  And   履歴パネルに要約が「個人および法人に関する内容です。」のような過不足のない一文しかないレコードがある
  And   そのレコードの送信コンテンツは 193 B と極端に小さい
  When  エントリヘッダーの「AI要約を作り直す」を押し、緩和段階「やや緩い」を選ぶ
  Then  ページが再取得され、既存③ルール選択を1段階緩めた設定（①抽出は PBI 05 ガード適用）で AI に再送される
  And   同じレコード行の summary・content・バイト統計・トークン数が新しい値に更新される
  And   同一 URL のレコード数は増えない（id は不変）

Scenario: グローバル設定を汚さない
  Given クレンジング設定の現在のプリセットが aggressive である
  When  再生成を「やや緩い」で実行する
  Then  この1回だけ balanced相当の設定で処理される
  And   chrome.storage のクレンジング設定とプリセット選択は変更されない

Scenario: 現在設定が custom のときの緩和（Ask 2026-09-22）
  Given クレンジング設定が custom（個別トグル組み合わせ）である
  When  再生成を「やや緩い」で実行する
  Then  この1回だけ minimal 相当（有効3ルール）で処理される
  And   「最も緩い」では ②Content Cleansing + ③AI要約クレンジング が無効になる

Scenario: 再生成結果で tags が更新される（Ask 2026-09-22）
  Given 餓死 content から生成された誤 tags を持つレコードがある
  When  再生成に成功する
  Then  新しい summary とセットの新しい tags で上書きされる
  And   旧 tags は保持されない（tags は AI 生成のみ — dashboard に tags 編集 UI は存在せず、上書きで失う手動データは無い（Why 連鎖B・grep 確認済み））

Scenario: 設定でブロックされたドメインの強制再生成（Ask Q1C 2026-09-22）
  Given 記録後にドメインフィルタでブロックされた（または noai 等の privacy headers で拒否される）ドメインのエントリがある
  When  再生成を実行する
  Then  通常経路（force なし）は gate でエラーになり「設定を無視して強制再生成」が提示される
  And   強制を選んだときのみ force=true で再試行され、選ばない限り AI に再送されない

Scenario: 再生成時に副作用が skip される（Ask 2026-09-22）
  Given Obsidian 自動 append とローカルMarkdown自動エクスポートが両方有効な設定である
  When  再生成に成功する
  Then  SQLite（+ legacy metadata）のみが更新される
  And   Obsidian への自動 append もローカルMDの自動書き換えも発生しない（送信は手動追記ボタンのみ）

Scenario: content保存OFFのエントリを再生成する（Ask 2026-09-22）
  Given contentEnabled=false の設定で作られ content 列が NULL のエントリがある
  When  再生成に成功する
  Then  summary・tags・統計は新値に更新される
  And   content 列は NULL のまま（プライバシー設定を再生成が上書きしない）

Scenario: localhost記録の再生成はエラーになる（Ask 2026-09-22）
  Given 履歴に localhost で記録されたエントリがある
  When  再生成を実行する
  Then  blockLocalhost チェックでエラーメッセージが表示され、既存データは不変

Scenario: 再取得やAI呼び出しが失敗したとき、既存データを壊さない
  Given 保存済みの要約と送信コンテンツがあるレコードがある
  When  再生成を実行したがページ取得がタイムアウトした（またはAI呼び出しが失敗した）
  Then  エントリ行にエラー理由が表示され、ボタンが再押下可能な状態に戻る
  And   summary・content・統計は実行前のまま維持される

Scenario: 再生成中に二重押下しない
  Given 再生成が進行中である
  When  ユーザーが同じボタンを連打する
  Then  2件目以降はキューされず無視され、AI呼び出しは1回だけ発生する

Scenario: 緩和なし（現在の設定）でも再生成できる
  Given 過剰クレンジングではなくプロバイダの調子が悪いだけのレコードがある
  When  再生成を「現在の設定」で実行する
  Then  グローバル設定そのままのクレンジング（抽出パイプライン経由）で再送・更新される
```

## 受け入れ基準
- [x] 履歴エントリヘッダーに「AI要約を作り直す」ボタンと緩和段階選択（現在の設定 / やや緩い / 最も緩い）が表示される（i18n: ja / en 両方）
- [x] 再生成後も同一 URL のレコードは1件のまま（update-in-place）。新規 INSERT が発生しないことをテストで pin した
- [x] 再生成の緩和段階選択はグローバルのクレンジング設定・プリセットを永続化しない
- [x] 緩和は既存③ルール選択（AI要約クレンジング32ルール/プリセット）の段下げとして実装され、①候補選択に新しい緩和オプションを追加しない（v1スコープ・Ask 2026-09-22）
- [x] custom 設定時: 「やや緩い」= minimal 相当、「最も緩い」= ②③無効 の ladder が Pure function として実装・テストされている（Ask 2026-09-22）
- [x] 再生成成功時に新 tags で上書きされること（BDD: 誤tagsレコードが新summaryと整合する tags になる）
- [x] `'regenerate'` は Obsidian 自動 append を skip し、ローカルMD自動エクスポートも skip すること（副作用skip両方をテストで pin）
- [x] contentEnabled=false のエントリ再生成後も content 列が NULL であることをテストで pin
- [x] localhost URL の再生成が blockLocalhost でエラーになり、既存データが不変であることをテストで pin
- [x] source policy `'regenerate'` の force は既定なし。gate で弾かれた場合のみ「設定を無視して強制再生成」を提示し、選択時のみ force=true であること（Ask Q1C・force 既定 ON をテストで pin しない）
- [x] 取得失敗・AI失敗・タイムアウト時に元の summary / content / 統計が不変で、エラーがエントリ行内に表示される
- [x] 通常の記録経路（VALID_VISIT / MANUAL_RECORD / SAVE_RECORD）の保存結果が従来と byte-identical であることをテストで pin した
- [x] 再生成による AI 送信が監査ログに記録される
- [x] 再生成結果が既存の「Obsidianに追記」ボタンで送信できる（`obsidian_synced` を問わず追記できることを確認。新規 Obsidian API を増やしていない）
- [x] 一括再生成は v1 スコープ外（multi-select ボルク操作は将来候補。個別ボタンのみ）
- [x] 二重押下防止（in-flight 中はボタン disabled）とレート制限（manual record と同じ `checkRateLimit`）が効く
- [x] `npm run validate`（type-check + test）と `npm run build` が通る

## テスト戦略（t_wadaスタイル / Outside-In）

```
E2E（最小限）
  └─ over-cleansed ページで記録 → 再生成（緩和）→ レコード数1のまま summary/content が更新・エラー時 non-destructive
統合（中程度）
  └─ REGENERATE_SUMMARY の validator / trust level（extension-only）/ レスポンス契約
  └─ recordRequestBuilder の 'regenerate' source policy（skipDuplicate・targetId・副作用skip両方・force 既定なし）
  └─ gate 拒否 → 強制選択 → force=true 再試行の分岐
  └─ 保存ステップの UPDATE vs INSERT 分岐
  └─ GET_CONTENT 経路: cleanseMode override が抽出/Content Cleansing/AI要約クレンジング設定に伝播し、byte 統計が返る
単体（多数）
  └─ 緩和段階 → 実効設定解決の純粋関数（preset 1段階下げ・custom=minimal相当・最緩=②③無効・永続化なし）
  └─ 失敗時 non-destructive（UPDATE は AI 成功後にのみ発行）
  └─ 副作用skip（Obsidian append / ローカルMD 両skip）が source policy で効くこと
  └─ tags 上書き（新 tags が UPDATE に乗る・created_at 等の非対象列が不変）
  └─ ボタン配線（wireEntryList）と in-flight disabled
  └─ i18nキーの ja / en 存在
```

比率の目安: E2E:統合:単体 = 1:10:100。実装は E2E（RED）→ 統合 → 単体の順に外から埋める。

## 実装アプローチ
- **Outside-In**: E2E の再生成シナリオを先に書き、失敗を確認してからメッセージ → ハンドラ → パイプライン分岐の順で実装
- **Red-Green-Refactor**: 各レイヤーで TDD。グリーン後、通常記録経路の byte-identical pin を追加してからリファクタリング
- 推奨構造:
  1. 新メッセージ `REGENERATE_SUMMARY { id, cleanseMode, force? }`（`extension-only` trust level。登録は `messageTypes.ts` / `validators.ts` / `MessageRouter` / `compositionManifest`。URL は entry.url（DB 由来）のため新規注入不能・extension-only + ssrfGuard で安全（Why 連鎖P））
  2. ゲートウェイ `regenerateSummary()`（`pendingRecordGateway.ts` の envelope + 20s タイムアウトパターンを流用）
  3. 再取得経路の設計判断（**重要**）:
     - **推奨: GET_CONTENT + 設定オーバーライド** — 再生成用バックグラウンドタブを読み込み、コンテンツスクリプトの抽出パイプラインへ `cleanseMode` 相当の `CleansingConfig` 上書きを渡して `GET_CONTENT` を実行（`getContentHandler.ts` に override payload を追加）。これなら**実際の抽出/Content Cleansing/AI要約クレンジング経路を緩和設定で再実行でき、byte 統計（`page_bytes` 等）も揃う**（`toGetContentReply` は byteStats/aiStats/fallbackTriggered/cleanseStats を既に返却）。本 PBI の「クレンジングを緩める」が意味を持つのはこの経路のみ。
     - **manifest に `tabs` 権限が無く `tab.url` を読めないため既存タブ再利用は実質不可 → 毎回新規バックグラウンドタブ**。生成失敗・クローズ失敗・応答前後の閉じるタイミング・10s 待機を設計に含める（深掘り 2026-09-22）
     - 非推奨: `ManualContentFetcher.fetchContent` — innerText 抽出（上限 10,000 文字）だけで抽出パイプラインを**通らない**ため、①候補選択・②Content Cleansing が実行されず、`cleanseMode` が意味を持たない上に統計が欠測する（落とし穴参照）。
  4. ハンドラ: エントリ読込 → **URL 事前チェック（`validateUrl` の blockLocalhost 維持・Ask 2026-09-22 — localhost/内部IP はエラー「このURLは再生成できません」を返す）** → **gate 通過（force なしで domain filter / trust / privacy headers を再評価）→ gate で弾かれた場合のみエラー応答に「設定を無視して強制再生成」アクションを添える（選択時のみ `force: true` で再試行・Ask Q1C 2026-09-22）** → GET_CONTENT → `buildRecordRequest('regenerate', { targetId, cleanseMode, force?, ... })` → `recordingPipeline.record()`
  5. `recordRequestBuilder` に source policy `'regenerate'`（**`RecordRequestSource` union に追加**。`skipDuplicateCheck: true` + **force 既定なし — gate 弾き時のみ caller 側で明示 `force: true`（Ask Q1C 2026-09-22。force の実体は domain filter / trust / privacy headers 全バイパスのため既定は通さない）** + `targetEntryId` + `skipObsidianAppend: true` + `skipLocalMarkdownExport: true`（Ask 2026-09-22: 副作用skipは両方）+ `recordType: 'manual'`）。**skipObsidian/skipLocalMD は `SourcePolicy` / `RecordDiagnosticFields` に optional フィールドを追加し `pickDefined` が undefined を落とす性質で通常経路 byte-identical を維持（Why 連鎖C）**
  6. 保存ステップ: `targetEntryId` があるときだけ UPDATE（summary / content / **tags** / byte統計 / tokens / ai_provider / ai_model / ai_duration_ms / masked_count / cleansed_reason）。**created_at / url / title / domain / is_starred は不変**。**content 列は contentEnabled 設定を尊重**（Ask 2026-09-22: OFF のエントリは再生成後も content=NULL のまま、summary/tags/統計のみ更新）。UPSERT 列が足りなければ `src/offscreen/schema.ts` の `UPDATABLE_FIELDS` へ追加（4バックエンド同時拡張の注意書きを読む）
  7. 緩和: `cleanseMode` → 実効設定を純粋関数で解決。**Ladder（Ask 2026-09-22 確定）**:
     - **現在の設定**: そのまま
     - **やや緩い**: ③ルール選択を1段階下げ（aggressive → balanced → minimal）。**現在設定が custom のときは minimal 相当**（有効3ルール）。floor は minimal
     - **最も緩い**: **②Content Cleansing + ③AI要約クレンジング 無効**（その1回のみ、storage 永続化なし）
     - **（Ask 2026-09-22 確定）緩和＝既存③ルール選択の段下げ + 最緩での②併用無効のみ**。設定パネルの既存トグル（`ai-summary-cleansing-enabled` + 個別ルール + preset select）と同じ語彙を使う。**①候補選択の緩和は v1 対象外**（この種の選択肢が既存UIに存在しないため。①は PBI 05 のガードが抽出時に自動対応し、regenerate 経由でも同一ガードが発火する — item 8 の統一方針と一致）。SMBC型（①主因）の再生成は、cleanseMode ではなく 05 ガードの body path フォールバックで改善する
     - **storage への永続化は一切しない**。custom 判定は現行 `PRESETS` の custom 識別（3プリセット一致なし）を流用
  8. **緩和×ガード（深掘り確定）**: PBI 05 導入後も**緩和再生成中はガードを発火させる（統一）** — クレンジング緩和（送信前処理の軸）と過剰削減ガード（抽出品質の軸）は非干渉の別軸とし、special-case を作らない

## 見積もり
8 SP（要チームでの見積もり。ボタン+パイプライン分岐+UI の最小 slice に絞れば 5 SP に分割可能）

## 技術的考慮事項
- 依存関係: ネットワーク必須（ページ再取得）。オフライン時はエラー表示のみ（オフラインキュー PBI とは別経路で衝突しない）
- テスタビリティ: ハンドラは GET_CONTENT / pipeline / sqlite を依存注入（`ManualRecordHandlerDeps` と同じ形）。緩和解決は純粋関数
- 非機能:
  - Service Worker は ephemeral → 状態を持たず、メッセージ内完結（`async` + `return true` パターン）
  - `isSecureUrl` + `ssrfGuard`（localhost block）+ `checkRateLimit` を MANUAL_RECORD と同等に適用（再取得タブ生成時も同方針）
  - CSP: 動的コード実行なし（kilorules 遵守）
  - AI コスト: 監査ログ必須、二重押下防止必須
- Obsidian 連携（**深掘り 2026-09-22 確定**）: 再生成結果は **SQLite（+ legacy metadata）のみ更新**。気に入った結果は既存の「Obsidianに追記」ボタン（`append_to_obsidian` — `obsidian_synced` を問わず ids[] を追記・削除しない）で手動送信する。**Obsidian へは追記のみ・削除しない**（元レコードの section と重複sectionになるがユーザー許容済み）。新規 Obsidian API コードは一切不要
- ロールバック: 新規メッセージ・source policy・ボタン追加はすべて additive。無効化すれば旧挙動に完全復帰

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）
```bash
rg -n "regenerate|再生成" src/                          # 既存機能の有無を再確認
rg -n "MANUAL_RECORD|buildRecordRequest|skipDuplicateCheck" src/background -g '!*.test.ts'
rg -n "DASHBOARD_MUTABLE_SUBSET|UPDATABLE_FIELDS" src/
rg -n "PRESETS|cleanseMode" src/utils/aiSummaryCleaner/
```
- 既実装なしを 2026-09-22 に確認済み（上記「既実装確認」参照）。ただし実装開始時に再grepすること

### 実装手順
1. **再現確認**: `qa.smbc.co.jp` の FAQ ページを現行設定で記録し、切り分けを行う — (a) ①候補選択が最初から小さいのか、(b) `applyFallback` が body.innerText 復元したがそれも小さいのか、(c) whitelist 経路か、(d) `page_bytes` に body 内の `<script>` テキストが含まれて分子が実態より大きくなっていないか（`index.ts:398` の `body.textContent` は script/style を含む）。結果と、「計測なし」が未実行か計測破棄かをこの PBI の背景に追記。e2e 用に `testDir/e2e/test-pages/` へ再現ページを追加
2. i18n: `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` に `historyRegenerateSummary` / `historyRegenerateMode*` / `historyRegenerateError` を追加
3. View: `buildEntryListHtml` のヘッダーに `data-action="regenerate"` ボタン + 緩和段階 select、`wireEntryList` で `callbacks.onRegenerate(id, mode)` を配線。in-flight はボタン disabled + `record-error-message` パターン（`renderPendingRegion` 参照）でエラー表示
4. Panel/Model: `SqliteHistoryViewCallbacks` に `onRegenerate` を追加し、新ゲートウェイを呼ぶ → 成功時にモデル再読み込み
5. メッセージ層: `messaging/types.ts` の応答型、`validators.ts` に validator、`messageTypes.ts` の `VALID_MESSAGE_TYPES` + `ExtensionMessage`、`MessageRouter` に registry（`extension-only`）+ validator 登録、`compositionManifest.ts` で配線
6. ハンドラ: エントリ読込 → GET_CONTENT（cleanseMode override 付き）→ `buildRecordRequest('regenerate', ...)` → `pipeline.record()`。取得失敗・AI 失敗は UPDATE 発行前に応答を戻す
7. `recordRequestBuilder.ts`: `'regenerate'` policy を追加（`RecordRequestSource` union 拡張。既存 `'manual'` と何が違うか — skipDuplicate は同じが force 既定なし・targetId 付き・副作用skip 2種 — をコメントで明示）
8. 保存ステップ: `targetEntryId` があれば UPDATE 分岐。**通常記録経路の出力が byte-identical であることを pin テスト追加後に**実装。**perUrlMutex 経由を確認し、同一 targetEntryId への後勝ち UPDATE が冪等であることをテストで pin（Why 連鎖H — ゲートウェイ timeout 後も SW は pipeline を完走しうる）**
9. 緩和解決: `cleanseMode → 実効設定` の純粋関数を `presets.ts` 近辺に追加（ladder: 現設定 / 1段階下げ（custom=minimal相当）/ ②③無効。永続化なしを型/テストで保証）
10. E2E: `testDir/e2e/` に再生成シナリオを追加（モックAIで summary 差分を検証）

### 落とし穴
- **`MANUAL_RECORD` を流用するだけで済ませると、`skipDuplicateCheck: true` のため同じ URL のレコードが2件になる。** update-in-place を最初に決める
- dashboard の `update` subtype に `content` / byte統計は**意図的に**無い（`dashboardMutableSubset.test.ts` が pin）。ここを拡張しないこと。background 経路を使う
- 保存ステップの UPDATE 分岐を通常記録に波及させると全レコード記録が壊れる。`targetEntryId` があるときだけ発火し、ピンテストを先に書く
- `ManualContentFetcher` は innerText 上限 10,000 文字 + nav/header/footer 除去であり、**抽出パイプライン（候補選択・Content Cleansing・AI要約クレンジング）を一切通らない**。この経路では `cleanseMode` が機能せず、page_bytes 等の統計も欠測する（「欠測時も一貫表示」PBI 2026-09-18-21 の reason 行で表示されることを確認）。**再生成は GET_CONTENT + override 経路を推奨**（推奨構造 3 参照）
- GET_CONTENT 経路: `handleGetContentMessage` は `deps.extractAndCommit()` を**引数なしで**呼んでいた（config 未伝播）。`extractAndCommit: (config?: CleansingConfig)` は既に override 可能 — handler の `GetContentMessage` に config payload を足して渡すだけでよい。タブ読み込み後にコンテンツスクリプトが注入済みであることを前提に、待機とタイムアウトを定義する
- fetch は既存タブまたはバックグラウンドタブ生成（10s タイムアウト）+ localhost block。取得結果は5分キャッシュ → 再生成直前のページ変更を取りに行く場合はキャッシュをバイパスするか TTL 内であることを明示する（GET_CONTENT 経路ならキャッシュは介在しない）
- AI要約クレンジングが「計測なし」の実例では①候補選択が主因（背景の表参照）。**cleanseMode は③ルール段下げのみ（①対象外・Ask 2026-09-22）なので、本件の改善は PBI 05 ガードの body path フォールバック経由**。①を緩める新規オプションを発明しないこと
- 新規 `UPDATABLE_FIELDS` 追加は IdbVfsBackend / FallbackStorage / OPFS worker / offscreen の4経路に同時波及する（schema.ts のコメント参照）
- **`pageState.cleansingConfig` はページロード時のスナップショット** — 設定画面でクレンジングを変更した直後の再生成は、変更前の設定で抽出される（GET_CONTENT の config は pageState 基準）。即時反映が必要になったら再生成前に loadSettings を再実行する拡張が要る（v1 では許容）


## 関連PBI
- [2026-09-22-05-feat-extraction-overcut-guards.md](2026-09-22-05-feat-extraction-overcut-guards.md)（予防）: 記録時の過剰削減ガード（Content Cleansing に本文保護/復元、候補選択に最小サイズ、過剰削減FBの発火条件を AI要約クレンジング非依存化）。本 PBI（治療=手動再生成）と独立に成立する。ガードが効けば新規レコードの再生成需要は減り、本 PBI は既存壊レコードとAIプロバイダの揺らぎ向けに残る。再取得経路とガードの語彙（`fallbackRatio` / `fallbackMinBytes` / body path フォールバック）は両 PBI で統一する。**①候補選択の実質的な改善は 05 側に一元**（cleanseMode は③のみ・Ask 2026-09-22）
- **実装順（深掘り 2026-09-22 確定）: 05 先行 → 04**。根因対策を先に、かつ両PBIが contentExtractor 周りを触るためファイル衝突を避ける。04 着手時は 05 の発火条件・語彙を引き継ぐ

## 深掘りセッション — 2026-09-22

### 挑戦した仮定
| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| GET_CONTENT 再取得が機能する | 高・実現可能性 | `content_scripts.matches` は `<all_urls>` で自動注入成立、`toGetContentReply` は byteStats/aiStats/fallbackTriggered/cleanseStats を返却済み。ただし `tabs` 権限が無く `tab.url` を読めないため既存タブ再利用は実質不可 | **毎回新規バックグラウンドタブ**前提で待機・クローズ・失敗設計を明記 |
| v1 は Obsidian 既存ノートを更新しないで価値がある | 高・ユーザー行動 | daily note append モデルで置換API無し。`append_to_obsidian` は `obsidian_synced` を問わず ids[] を追記し削除しない | **SQLite 更新のみ + 気に入ったら既存の「Obsidianに追記」ボタンで手動送信。Obsidian は追記のみ・削除しない**（新規 Obsidian コード不要・重複sectionは許容） |
| 緩和3択selectを毎回選ばせるUXでよい | 高・ユーザー行動 | 当初要望は「押すと作り直す」+「緩めてほしい」の両立 | **3択select 維持（現状案）** |
| 一括再生成はスコープ外 | 中・スコープ | multi-select + ボルクバー（追記）は既存 | **v1 は個別のみ**。一括は将来候補（進捗UI・部分失敗・レート制限が別途必要） |
| 04/05 の実装順 | 高・依存関係 | RICE 05(1.75) > 04(0.96)、両者 contentExtractor 周りを触る | **05 先行** |
| 緩和再生成中のガード扱い | 高・依存関係 | 05導入後は04の GET_CONTENT 再抽出にもガードが発火し得る | **緩和中もガード発火（統一）** — クレンジング緩和と抽出品質ガードは非干渉の別軸 |
| cleanseMode の緩和対象 | 高・スコープ | 設定パネルの既存選択肢（③マスター + 32ルール + preset select）が確認できた。①候補選択には既存選択肢が存在しない | **緩和＝既存③ルール選択の段下げのみ。①は v1 対象外**（05ガードが抽出時に自動対応、regenerate 経由でも発火は統一方針） |

### 新たに発見したリスク
- 毎回新規タブ: 生成/クローズ失敗、応答前後どちらで閉じるか、10s 待機、バックグラウンドタブ増殖の体感
- 再生成結果を Obsidian に送ると元レコードの section と**重複する**（削除しない方針の副作用・ユーザー許容済み）
- localhost/認証ページ: `ManualContentFetcher` は `validateUrl` で localhost を block — GET_CONTENT 経路でも方針統一が必要

### 未解決の疑問
- （解消 2026-09-22 Ask）content 保存OFF時の content 列 → 設定尊重・NULL維持 / localhost再生成 → blockLocalhost 維持でエラー
- 新規タブを閉じるタイミング → 技術裁定で「応答後 finally クローズ」に確定（上記「技術裁定」参照）
- 将来の一括再生成（v1対象外）— 進捗UI・部分失敗・レート制限設計を別 PBI にするか、04 完了後の需要判断で裁定

### 決定事項（旧 dig 2026-09-22）
1. Obsidian 運用 = SQLite 更新 + 手動追記（削除しない・重複許容）
2. 緩和UI = 3択select
3. 実装順 = 05 先行
4. 緩和中もガード発火（統一）
5. 一括再生成 = v1 対象外
6. cleanseMode の緩和対象 = 既存③ルール選択の段下げのみ、①候補選択の緩和は v1 対象外（Ask 2026-09-22）
7. custom 時の ladder = やや緩いは minimal 相当・最も緩いは ②③無効（Ask 2026-09-22）
8. tags = 新 tags で上書き（Ask 2026-09-22）
9. 副作用 skip = Obsidian 自動 append + ローカルMD自動エクスポート両方 skip（Ask 2026-09-22）
10. localhost = blockLocalhost 維持・再生成はエラー（Ask 2026-09-22）
11. content 保存OFF = 設定尊重・content 列は NULL のまま（Ask 2026-09-22）

### 技術裁定（Ask 不要・実装時にこの通り）
- タイムアウト階層: タブ待機 10s（内部）→ ゲートウェイ `REGENERATE_TIMEOUT_MS = 60000`（AI 呼び出しを含むため pending の 20s とは別定数）→ 失敗は non-destructive エラー表示。**ゲートウェイ timeout 後も SW は pipeline を完走し同一行 UPDATE しうるが冪等（同一 targetEntryId 後勝ち・Why 連鎖H）**
- タブクローズ: ハンドラの `finally` で応答後クローズ（`ManualContentFetcher` と同パターン、close 失敗は握りつぶす。sendResponse 後でも finally は動く — Why 連鎖N）
- **GET_CONTENT 応答保証（Why 連鎖D）**: `chrome.tabs.onUpdated` の complete 待機に加え、`tabs.sendMessage` が "receiving end does not exist" を返した場合は 200ms 間隔で最大10回リトライ（注入完了待ち）。既存 `contentFetchGateway.ts` のリトライパターンを踏襲
- **RateLimiter の sender キー確認（Why 連鎖L）**: popup / manual 記録と同一キーだと競合して予期せず制限される。必要なら regenerate 専用 namespace を分離
- fallback reason の新値: `candidate_too_small`（①）/ `content_overcut`（②）。既存 `short_content` / `over_cleansed` は不変。i18n 両言語追加

### なぜなぜ分析 — 2026-09-22（15連鎖・47 Why 実施）

| 連鎖 | 結論 |
|------|------|
| A: force の要否 | **Ask Q1C**: force 既定なし + gate 弾き時のみ強制選択 |
| B: tags 上書きの安全性 | **解**: dashboard に tags 編集 UI 不存在（grep）→ BDD 文言を事実に修正 |
| C: 副作用skip フィールド | **解**: optional フィールド + pickDefined で byte-identical 維持 |
| D: GET_CONTENT 応答保証 | **解**: complete 待機 + sendMessage リトライを技術裁定に追加 |
| H: timeout 後の完走 | **解**: perUrlMutex 確認 + 後勝ち UPDATE 冪等を手順に追加 |
| I: 追記ボタンの整合 | **解**: UPDATE 後の行を ids で読むため成立（重複 section は dig 許容どおり） |
| K: BDD の 05 前提 | **解**: シナリオ1 に「05 導入済み」Given 追加 |
| L: レート制限キー | **解**: sender キー確認を技術裁定に追加 |
| N: finally クローズ | **解**: 技術裁定どおりで十分 |
| P: extension-only 安全性 | **解**: URL は DB 由来・新規注入不能。ssrfGuard 残存で安全 |

（選択で解消した連鎖 A/E/F は各 Ask の決定として上部に反映済み）

## 深掘りセッション — feature-dev Phase 2b（2026-09-22）

### 挑戦した仮定（Phase 2 コード調査で新規に発見した暗黙前提のみ。旧 dig/Ask/なぜなぜの再議論はしない）

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| 「全BDDシナリオを自動テストで充足」= 既存 harness で足りる | 高・実現可能性 | e2e は real-extension Playwright（localhost + seed 実績）だが **AI モックの先例ゼロ**。フルロー（SWタブ→GET_CONTENT→AI→UPDATE）は AI route 拦拒の新規構築が必要。localhost は blockLocalhost で再生成が弾かれる | **フルローe2eを新規構築（Ask N1-B）** — playwright `context.route` で (a) 非localhost の fixture ドメイン（例 `https://e2e-regenerate.test/**` → HTML を fulfill）、(b) AI provider エンドポイント（設定の baseUrl を routed ドメインに向けて canned 応答）を拦拒。設定 seed は options ページの storage 経由 |
| 「manual record と同じ checkRateLimit」 | 高・ユーザー行動 | キー = sender origin、**dashboard と popup が同一バケット**、既定 **5回/60秒** → 再生成6連打で popup 手動記録も 429 | **再生成専用バケットに分離（Ask N3-B）** — `RateLimiter.check` に optional bucket 引数（既定 '' で現状互換・既存キー形式の pin を維持）、regenerate は `'regenerate'` バケット。**上限値の設定キーは共用（5/60s）**としキーは増やさない — 「2系統の設定キー」はコストとして省略した解釈（要望なら +1 key で拡張可） |
| GET_CONTENT への optional payload 追加が契約を壊す | 低 | `NO_PAYLOAD_TYPES` 施行は SW 入站のみ（`isServiceWorkerRequest` / `envelopePolicy`）。GET_CONTENT は SW 入站しないため影響なし。popup の bare envelope 契約テストも維持 | **解**: payload は optional 追加のみ、NO_PAYLOAD_TYPES は触らない |
| needsForce 判定は `RecordingResult.reason` で可能 | 中 | `resultBuilder` が `error.reason` を伝播（recordingOutcome の PipelineError 経由） | **実装時検証事項**: gate 3種（domain-filter / trust / privacy-headers）の reason 値を特定し、その集合でのみ `needsForce: true` を返す。特定できなければ gate に識別子を追加 |
| cleanseMode 解決に settings→CleansingConfig の SW への抽出が必要 | 中・アーキテクチャ | Phase 2 発見: 変換は content script 側のみに存在。**ただし ladder 適用を content script 側（GET_CONTENT 受け手）に置けば不要** | **Phase 4 のアーキテクチャ選択肢として比較後に裁定**（現時点の推奨は content script 側 ladder） |
| saveSqliteStep に update 分岐を入れる | 中・アーキテクチャ | 現状常に INSERT | **Phase 4 で代替比較後に裁定** |

### 新たに発見したリスク
- フルローe2e は **外部ドメイン・AI API の route 拦拒 + 設定 seed** を前提に構築する。拦拒漏れ時は flaky（→ 参加タイムアウトと明確な失敗メッセージで早期表面化させる）
- blockLocalhost（Ask Q1C 確定）と e2e fixture の相性: localhost フィクチャでは再生成が弾かれる → **e2e は必ず非localhost routable ドメインを使う**
- レート制限分離は RateLimiter の既存 pin（キー形式テスト）に触れる — optional 引数で既定挙動不変をテストで pin する

### 未解決の疑問
- gate reason の具体値（実装時に `resultBuilder` / `recordingDecision` / step の PipelineError から特定）
- AI 呼び出しの監査ログが privacy pipeline 経由で再生成にも自動記録されるか（実装時に確認、なければ追加）

### 決定事項
1. **フルローe2eを新規構築**（AI route 拦拒 + 非localhost fixture ドメイン + 設定 seed）
2. **レート制限は再生成専用バケット分離**（カウンタのみ分離・上限設定キーは共用）
3. NO_PAYLOAD_TYPES は変更しない、needsForce は reason 特定後に実装、ladder 配置と update 分岐は Phase 4 裁定

## 実装結果 — 2026-09-22（Phase 5-7）

- **自動 DoD ゲート: 完了**
  - `npm run validate`（type-check + lint 0 errors + **13,158 tests green**）+ `npm run build` ✓
  - フルローe2e `testDir/e2e/regenerate-summary.spec.ts` **2/2 PASS** — 同一行 UPDATE（マーカー着地・URL の行は常に1件）/ cleanseMode の永続化なし（settings クレンジングキー不変）/ invalid_url はエラーロウ + 強制ボタンなし
  - 回帰e2e: `overcut-guard-recording` + `content-script-recording`（baseline）含め 8/8 PASS、chromium プロジェクトの dashboard-ui + cleansing-preview-confirm 52/52 PASS
- **e2e bring-up で確定した基盤判断**:
  - 拡張が作るタブの**メインドキュメント要求は Playwright の route 拦拒に乗らない**（attach レース）→ `--host-resolver-rules=MAP api.openai.com:443 127.0.0.1:8443` + 自己署名TLS fixture（`testDir/e2e/fixtures/dev-server-*.pem`）で実ナビゲーションをローカル完結させる
  - AI mock は**固定ポート禁止**（1234 は実 LM Studio アプリが占有）→ `fixtures/localServers.ts` の許可ポート probe-pick（11434→27123→27124→1234）+ 明示 IPv4 bind + bind 待機
- **Phase 7 レビュー（3体）で修正したもの**: in-flight の check-then-act レース（同期 add 化）/ UPDATE 失敗が success に化ける問題（`RegenerateUpdateError` → 終端エラー・pending 登録なし）/ `contentEnabled=false` 時の content 消し込み（key omit 化）/ レート制限メッセージの大文字不一致（case-insensitive + reason 経路）/ `fallback_reason` の読み取り到達（SEARCH_COLUMNS + FTS/LIKE SQL + legacy patch + enrichment、OPFS/light list も表示可能に）/ regenerate 時の tags マージ（replace 化）/ `.then` チェーン（.kilorules 違反）/ gateway のタイムアウト重複と共通化（`withRuntimeTimeout` + unhandled rejection 修正）/ fetcher の chrome 直叩き（DI 化）/ migrationBackup の列位置脆さ / HTML の save ボタン i18n キー破壊と status 要素削除の復元 / e2e ポート・bind 待機 / 文字数フロア min:1 / mode allowlist 単一情報源化
- **意図的に残したもの（判断理由つき）**: offline×regenerate の enqueue は insert 経路のみから到達不能（update 分岐が先行 return — 構造上 unreachable、payload passthrough は実装しない）/ firefox e2e プロジェクトは既存環境起動失敗（Nightly profile・本変更と無関係）/ `pageState.cleansingConfig` のスナップショット鮮度（落とし穴に記録・v1許容）
- **/review 指摘（2026-09-22）で修正**: AI失敗時のリカバリ経路が UPDATE-only に反する問題 — ①`StepExecutor.enqueueOfflineJob` が regenerate（targetEntryId あり）を offline 登録から除外、②`decideStepOutcome` の RETRY 終端で regenerate の pending page 登録をスキップ（どちらも INSERT 複製を防ぎ、失敗はエラー result + 通知で表面化）、③空 tags の再生成で legacy ミラーの tags を置換（`patch.tags = []` 明示・mergeTags=false は維持）— 単体テスト4件追加、validate/build 再グリーン
- **AI失敗フォールバック hardening（2026-09-22 実利用報告を受けて）**: `buildResult` が常に `success:true` を返し、失敗プロバイダのエラー文が summary として保存→再生成で上書きされていた問題を修正。`PrivacyPipelineResult.aiSucceeded` を `RecordingResult` までスレッドし、失敗時は save 層（`saveSqliteStep` UPDATE スキップ）と handler 応答（`ai_failed` + i18n）の両方で非破壊を保証。RemoteAIService のスロットループ自体は既に全プロバイダ走査していたため、追加でスロット単位の WARN ログ（provider/model/index/total）で可観測化。単体9件 + e2e 2件（モデル判別 mock による cross-provider retry / 全滅時 non-destructive）追加
- **/review 指摘（2026-09-22）で修正**: コントラスト不良（存在しない `--color-bg` トークンへのフォールバックで select/force ボタンが両モード白背景になり、star ボタンは UA デフォルト面 — token 整備）+ AI全滅時に**試行したプロバイダ一覧**をエラーロウの detail 行で表示（`attemptedProviders` を `RecordingResult`/`RegenerateSummaryResponse.providersTried` までスレッド）。e2e 2件追加（cross-provider retry / 全滅時 non-destructive）、validate 13,179 緑 + e2e 5/5 緑
- **スロット別エラー詳細の深掘り（2026-09-22 二度目のご報告を受けて）**: 「3プロバイダとも同じエラーに見える」正体は ①ループが `lastResult` のみ保持し **最後のスロット（built-in-ai）の `kErrorUnknown` だけが見えていた** こと、②実際の HTTP 失敗は `fetchWithRetry` が non-ok で **throw** するため `handleErrorResponse` は本番到達不能で、summary-flow の catch がメッセージを捨てていたこと、の2段。修正: (a) `AISlotFailure` 型を導入し `slotFailures`（provider/model/error・成功スロット以前の失敗も保持）を AISummaryResult→PrivacyPipelineResult→RecordingResult→`providersTried`+`slotFailures` 応答→エラーロウ detail（`formatRegenerateErrorDetail`・1行/スロット）までスレッド、(b) summary-flow catch が `error: msg(300字)` を保持（本番の HTTP status が初めて可視に）、(c) OpenAI/Gemini の `handleErrorResponse` は summary 綨文（セキュリティ pin 綨文）+ `error: HTTP <status>`、(d) スロット WARN ログに error 追加。`kErrorUnknown` 自体は Chrome オンデバイス Prompt API の汎用エラー（接続テストは1語プロンプトなので通り、実コンテンツで壊れる典型）。単体+10件・既存 pin 更新2件・validate 13,185 緑 + build 緑
- **根因の確定（2026-09-22 detail 行の実測で完了）**: openai / gemini は両者 `Monthly token limit reached (1,017,238 / 1,000,000)` — **拡張自身の月間トークン上限（`max_monthly_tokens`・既定1,000,000・全HTTPプロバイダ共有の単一カウンタ）が `checkPreFlight` でブロック**しており、API には一切当たっていない。これが「AIテストは通るのに実行で落ちる」非対称の正体（`executeHttpTestFlow` は `checkPreFlight` を呼ばないため上限をスキップ）。built-in-ai は preflight スキップ設計（上限外）で、別要因の `kErrorUnknown`。対処: ①`mapRegenerateError` に slotFailures を渡し、monthly-limit 検出時は**専用メッセージ**を出す（「別のプロバイダーを試す」は全HTTPが同一上限共有のため誤アドバイス）— 日英 i18n + テスト2件追加
- **三次目の深掘りで真因がさらに判明（2026-09-22）**: ユーザーは上限を「0 = 無制限」に設定済みなのにブロックされた → **writer/reader の保存先不一致**。UI（`recordingConditionsSettings`）は `SettingsRepository.setAll` で **`settings` ブロブ内**に書くのに、`aiUsageTracker.getMaxMonthlyTokens` は**誰も書かないトップレベルキー**を読んでいた → 0 も custom 値も全て無視され**常に既定 1,000,000** が適用されていた（この既定と使用量 1.017M が衝突したのが最初のエラー。`checkUsageWarning` も同一 getter を使うため同時に修正）。修正: 読み取り順を ①`settings` ブロブ（現行UI・0=無制限）→ ②旧トップレベルキー（移行前の書込み/テスト fixture）→ ③暗号化インストール用 SettingsRepository（dynamic import）→ ④既定 に変更。+4件の blob 優先順位テスト、validate/build 緑

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体）
- [x] 通常記録経路の byte-identical pin が存在し通る
- [x] `npm run validate` と `npm run build` が通る
- [x] コードレビュー完了（GitHub PR approve 必須。セキュリティ観点 — 新規メッセージの trust level・URL 検証・レート制限・監査ログ — を PR 説明に明記）
- [x] リファクタリング完了（グリーン後）
- [x] ロールバック手段の検討完了（additive 設計で旧挙動完全復帰を確認）
- [x] ドキュメント更新済み（`docs/AI_SUMMARY_GUIDE.md` に再生成の節、CHANGELOG、Obsidian 非更新の v1 制約を明記）
