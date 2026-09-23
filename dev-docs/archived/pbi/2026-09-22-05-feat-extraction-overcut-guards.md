# PBI: 抽出/Content Cleansing 段の過剰削減ガード（本文保護・過剰削減FBの横展開）

## ユーザーストーリー
Yasumaro を使う利用者として、記録時にコンテンツ抽出・Content Cleansing で本文が削りすぎられた場合、AI要約クレンジングの「本文保護」「過剰削減フォールバック」と同じ仕組みで自動的に守ってほしい、なぜなら実例では 30.6 KB のページが候補選択で 193 B まで削られ要約が「個人および法人に関する内容です。」の一文に潰れたが、Content Cleansing と候補選択には復元手段が一切無く、既存の過剰削減FB設定（20% / 300 bytes）も AI要約クレンジング実行時しか発火しないから。

## 優先度
- RICEスコア: 1.75（Reach=5 / Impact=2 / Confidence=0.7 / Effort=4）
- 根拠: 全記録の抽出経路に効く予防で到達は最大。記録品質・要約精度・トークンコストを同時に守る。ただし閾値 tuning と正常系回帰リスクがあるため Confidence は中。byte-identical pin と設定配線が必要なため Effort 4。
- 種別: ✨機能追加（feat）
- 難易度: 🔴高（5 SP 目安）
- 副作用: 🔴あり（全記録の抽出出力に影響し得る。閾値の取り違えは正常ページで過剰フォールバックを起こし、ノイズの混入・トークン増を招く）
- **実装順（深掘り 2026-09-22 確定）: 本 PBI を PBI 04 より先に着手する**（RICE 上位 + 根因対策先回り + contentExtractor 衝突回避）
- **デフォルトON（深掘り 2026-09-22 確定）**: 設定文言との対称性・即効性を、閾値未検証と body フォールバックのノイズ混入リスクより優先。吸収手段は段別 flag ロールバック + 実装手順 8 の実データ閾値検証

## 背景（2026-09-22 時点のコード照合）

### 実例（PBI [2026-09-22-04-feat-ai-summary-regenerate.md](2026-09-22-04-feat-ai-summary-regenerate.md) と共有）
| 診断行 | 計測対象 | 実測値 | 実行順 |
|---|---|---|---|
| コンテンツ抽出 | `page_bytes` → `candidate_bytes` | 30.6 KB → 193 B（99.4% 削減） | ①候補選択 |
| Content Cleansing | `original_bytes` → `cleansed_bytes` | 193 B → 193 B（0%） | ②クローン削除 |
| AI要約クレンジング | `ai_summary_*` | 計測なし | ③`cleanseAISummaryContent` |

主因は①候補選択。②はこのレコードでは削除ゼロだが、巻き込み削除が起きた場合の復元手段も無い。

### 3段階のガード棚卸し（2026-09-22 grep 確認）
| 段 | 保護機構 | 状態 |
|---|---|---|
| ①候補選択（`findMainContentCandidates` / `scoring.ts`） | — | **不在**。トップ候補が小さくても body フォールバックしない（body path は候補ゼロのときだけ） |
| ②Content Cleansing（`contentCleaner.cleanseContent`） | — | **不在**。Hard/Keyword Strip は件数を返すだけで、比率判定・復元・本文保護が一切無い |
| ③AI要約クレンジング（`cleanseAISummaryContent`） | 本文保護（`markBodyElements` 既定200）+ 過剰削減FB（`fallbackRatio` 0.20 / `fallbackMinBytes` 300 → pre-AI テキスト or body へ復元） | あり |
| 共通最終フロア（`applyFallback`） | `isTooShort`（最終テキスト <100 文字 → `body.innerText`） | あり（絶対チェックのみ・比率は③専用） |

### 既存過剰削減FBが効かない3つの理由
1. **発火条件が AI要約クレンジング依存** — `applyFallback` の `overCleansed` は `aiSummaryOriginalBytes !== undefined` を必須（`extractPipeline.ts:191-193`）。③が未実行/未計測だと比率・絶対量のどちらも発火しない。実例の「計測なし」はまさにこの状態。
2. **比較対象が③前後だけ** — 設定文言は「クレンジング後のコンテンツが元の何%未満に減った場合」と一般形だが、実装の比較先は pre-AI テキスト（③前）のみ。②の削減（`original_bytes` → `cleansed_bytes`）も①の削減（`page_bytes` → `candidate_bytes`）も対象外。
3. **設定配置が AI要約クレンジング パネル直下** — ①②には適用されていない（文言と適用範囲の乖離）。

### 関連する既存資産
- `bodyProtection.ts`: `markBodyElements` / `isBodyProtected`（③専用。`calculateReadabilityScore` で本文候補をマーキングして Strip から除外）
- `applyFallback`: コメントに「THE single copy of the fallback policy」とある**単一ポリシ集約点** — ②①へ拡張する際もここに足すのが既存方針
- 設定: `AI_SUMMARY_CLEANSING_FALLBACK_RATIO` / `FALLBACK_MIN_BYTES` / `BODY_PROTECTION_*`（`aiSummaryCleansingSettingsV2.ts`）
- ②復元素材: `runCleanseAndExtract` は `source.preCleanseText`（削減前テキスト）を既に保持 — 復元に追加取得不要
- テスト資産: `testDir/e2e/test-pages/over-cleansed-page.html`、`cleansing-preview-confirm.spec.ts`

### 既実装確認（フェーズ0、2026-09-22 実施）
- `contentCleaner.ts` に fallback / threshold / 保護系 grep 一致なし。`scoring.ts` に min / threshold / fallback 一致なし
- 「本文保護」「過剰削減」は `aiSummaryCleaner/` と設定 UI のみに存在
- archived に同種の横展開なし。ただし実装前に `2026-08-24-02-refactor-content-extractor-fallback.md`（fallback 統合）と `2026-08-30-01-feat-cleansing-readability-scoring.md`（readability scoring）の内容を目視し、矛盾・重複がないか確認する
- 結論: **未実装**。新規機能として成立する

## BDD受け入れシナリオ

```gherkin
Scenario: Content Cleansing が過剰に削ったとき、削減前テキストに復元する
  Given Content Cleansing が有効で、Keyword Strip が本文要素を巻き込む構造のページがある
  When  記録時の抽出パイプラインが実行される
  Then  クレンジング後のサイズが閾値（fallbackRatio 未満 or fallbackMinBytes 未満）になった場合、削減前の候補テキストに復元される
  And   復元が発火したことが fallback 理由として診断に反映される

Scenario: 候補選択のトップ候補が極端に小さいとき、body パスへフォールバックする
  Given body テキストが十分大きいが、スコア1位の候補テキストが絶対量閾値未満のページがある
  When  記録時の抽出パイプラインが実行される
  Then  候補パスを諦めて body パスで抽出される
  And   AI に送信される本文が候補の 193 B のままにならない

Scenario: AI要約クレンジングが無効でも過剰削減FBが機能する
  Given AI要約クレンジングが OFF、Content Cleansing が ON である
  When  Content Cleansing が閾値超の削減を行ったページを記録する
  Then  現状では発火しない overCleansed 判定が、②前後の比較ペアでも発火する

Scenario: 正常ページではガードが発火しない（回帰防止）
  Given 削減率が閾値内の一般的な記事ページがある
  When  記録する
  Then  従来どおりの抽出結果になる（ガード不発火を byte pin で保証）

Scenario: 段別フラグでロールバックできる
  Given ①②ガードの段別フラグが OFF である
  When  記録する
  Then  本 PBI 導入前の挙動と byte-identical である
```

## 受け入れ基準
- [x] ②Content Cleansing: 削減後が `fallbackRatio` 未満 or `fallbackMinChars`（文字数 knob・Ask Q3B）未満 → 削減前テキスト（`preCleanseText`）へ復元、fallback 理由が記録される
- [x] ①候補選択: トップ候補が `fallbackMinChars` 未満 → body パスへフォールバック
- [x] ③未実行（AI要約クレンジング OFF/未計測）でも①②ガードが発火する（`aiSummaryOriginalBytes` 必須条件の一般化）
- [x] 既存 `fallbackRatio` / 新 `fallbackMinChars` 設定が①②の hot path knobs として機能し、`fallbackMinBytes`（bytes）は③既存経路・診断のまま維持すること（単位分離をテストで pin）
- [x] **whitelist 抽出経路は v1 ガード対象外**（`index.ts:373` の early return は①②ガードも `applyFallback` も通らない — Ask Q2A 2026-09-22。「閾値内保証」は blacklist 候選/body 経路に限定されることをテスト名/ドキュメントで明示）
- [x] 正常ページ（ガード不発火）で従来と byte-identical であることをテストで pin した
- [x] ③の既存挙動・本文保護 threshold 設定・診断表示が無変更であること（③専用設定の非影響を pin）
- [x] 段別ロールバックフラグが存在し、OFF で旧挙動に完全復帰することをテストで pin した（**flag は ①②の2個・AI要約クレンジングパネルの「過剰削減ガード」セクションに配置・Ask 2026-09-22**）
- [x] i18n（ja / en）: ①②ガードのスイッチラベルと説明、fallback reason 新値（`candidate_too_small` / `content_overcut`）の診断表示
- [x] `npm run validate`（type-check + test）と `npm run build` が通る

## テスト戦略（t_wadaスタイル / Outside-In）

```
E2E（最小限）
  └─ 候補が極小の FAQ fixture（qa.smbc 再現）で記録 → 送信本文が閾値内に収まる（blacklist 候選/body 経路のみ・whitelist 対象外）
  └─ 正常記事ページで記録 → 出力 byte-identical（ガード不発火）
統合（中程度）
  └─ applyFallback 拡張の発火条件 matrix（②pair / ③pair / 両方 / 両なし × 閾値境界）
  └─ ①候補検査 → body path 合流（候補ゼロ既存分岐との統合）
  └─ 段別 flag / 設定保存 → optionBuilder 伝播
単体（多数）
  └─ ②復元ロジック（preCleanseText 復元・計測保持）
  └─ 閾値境界値（ちょうど閾値は発火しない）
  └─ flag OFF byte-identical
  └─ scoring 候補検査（1位/全候補、take=3 経路）
  └─ hot path で byte エンコードを増やさないこと（文字数比較）
```

比率の目安: E2E:統合:単体 = 1:10:100。実装は E2E（RED）→ 統合 → 単体の順に外から埋める。

## 実装アプローチ
- **Outside-In**: 極小候補 fixture の E2E（現状 193 B 送出を実測 RED）→ `applyFallback` 拡張 → ①検査 → 設定配線
- **集約点は既存方針どおり `applyFallback`**（「THE single copy」）— ②①の決定も同じ `FallbackDecision` 語彙で統一し、新規ポリシを別ファイルに増やさない
- 推奨構造:
  1. `FallbackInput` に②比較ペア（`preCleanseBytes` / `preCleanseText`）と①結果（候補サイズ）を追加。`overCleansed` の必須条件を「③ pair がある場合」から「いずれかの pair がある場合」へ一般化（③既存経路の挙動は不変を pin してから）
  2. **②③判定構造（Ask 2026-09-22 確定）: `applyFallback` 1箇所・両ペア受入・優先順で winner 決定** — 従来どおり抽出末尾の単一呼び出しに ②pair（preCleanse 対 post-cleanse）と ③pair（pre-AI 対 post-AI）の両方を渡す。優先順は **②復元（`content_overcut` → `preCleanseText`）> ③復元（`over_cleansed` → pre-AI）> 短文（`short_content` → body）**。二重発火は winner 決定で構造的に排除（判定を2箇所に分割しない — 「THE single copy」方針維持）。③入力が②復元で変わるケースは、②復元が winner になった時点で③pair を無効化（既存 `settleFallback` の計測破棄フローと同型）
  3. ①: `findMainContentCandidates` の**スコア順リスト全体を先頭から走査**し、閾値（`fallbackMinChars` — 下記 knob 参照）を最初に満たす候補を採用。全滅なら body path へ（候補ゼロの既存分岐へ合流 — **textContent 系 runCleanseAndExtract であって `short_content` の innerText 復元とは別経路。accordion 隠し本文も含むため SMBC 型には有利（Why 連鎖G）**）。理由値は `candidate_too_small`。**hot path 方式（Ask Q3B 2026-09-22）: 判定は文字数専用 knob `fallbackMinChars`（新 StorageKey・既定100）** — `fallbackMinBytes`（bytes）は③既存経路と meter 診断用と役割を分離し、ASCII/日本語の単位ずれを knob で明示制御。hot path で byte エンコードはしない（文字数比較のみ）。②の比率判定は両辺同じ単位の文字数で計算（比率は単位非依存）
  4. 設定: 既存 `fallbackRatio` を①②共通 knob として適用（文言どおり一般形に）。**絶対量 hot path 閾値は新 `fallbackMinChars`（文字数・Ask Q3B）— `fallbackMinBytes`（bytes）は③既存と診断のまま**。**段別 enable flags = ①②の2個のみ（Ask 2026-09-22 確定）** — 新 StorageKeys 2個。③ガードは既存 master チェックボックス（③OFF＝③系ガード自然OFF）と既存 fallback で足りるため新 flag を増やさない。**配置 = AI要約クレンジングパネルに「過剰削減ガード」新セクション（Ask 2026-09-22 確定）** — 既存閾値スライダー（過剰削減フォールバック）と同じ場所に集約し、①②の switch + 説明文 + `fallbackMinChars` 入力を追加。**デフォルトは ON**（深掘り 2026-09-22 確定 — 文言と対称、リスクは flags と手順8の実データ検証で吸収）。ロールバックは flags
  5. **緩和再生成との整合（深掘り確定）**: PBI 04 の緩和再生成（GET_CONTENT override 経路）でも**ガードは発火させる（統一）** — クレンジング緩和（送信前処理の軸）と過剰削減ガード（抽出品質の軸）は非干渉。special-case を作らない
  6. ②事前の本文保護マーキング（`markBodyElements` analog を Keyword Strip 対象除外に使う）は **v2 / 将来候補** — v1 は事後復元でカバーし、スコープを制御する

## 見積もり
5 SP（v1: ②事後復元 + ①絶対量フォールバック + 発火条件一般化 + 段別 flag。②事前本文保護マーキングと閾値 tuning は +2 SP で v2）

## 技術的考慮事項
- **byte-identical pin の範囲**: 「ガード不発火ケース」が同一であること。発火ケースは意図的に出力を変える（DoD の pin と矛盾しないようテスト名で区別する）
- **`page_bytes` は `body.textContent`（`<script>` / `<style>` テキストを含む）** — ①に `page_bytes` ベースの比率を使うと分子が実態より大きく過剰発火する。①は絶対量 `fallbackMinBytes` を主とし、比率は同一ソースの②pair でのみ使う
- **hot path**: meter 無効の通常経路で byte エンコードを増やさない — ①②の絶対量判定は**文字数 knob `fallbackMinChars`（Ask Q3B）**、比率は両辺同単位の文字数（単位非依存）。`fallbackMinBytes`（bytes）は③既存経路・meter 診断用と**役割を分離**し、設定文言でも区別する
- **whitelist 抽出は v1 ガード対象外（Ask Q2A）**: `index.ts:373` の early return は①②ガードも `applyFallback` も通らない。アダプタがサイト改修で壊れた場合の餓死は v1 の保証外（将来候補: whitelist 結果への①絶対量ガードのみ追加）
- **②復元は③の削除も同時に巻き戻る（Why 連鎖M）**: 復元先 `preCleanseText` は③前テキストのため、②winner 時は③結果が破棄されノイズ込みテキストになる。餓死よりマシとして許容（既存 `settleFallback` の計測破棄フローと同型）
- ③の既存挙動・診断・`BODY_PROTECTION_*` 設定は無変更。③固有 threshold を②①へ横展開しない（文言の「本文保護」スコア閾値は③専用のまま）
- Rollback: 段別 flags OFF → 旧挙動完全復帰（additive）
- セキュリティ: ローカル DOM 処理のみで外部送信なし。ただし**デフォルト ON の挙動変更**であることを PR 説明に明記
- ログ: 復元発火は既存 `logSanitize` / fallback reason 経路を使い、新規ログ形式を増やさない
- 閾値の妥当性: `fallbackMinBytes` 既定 300 を①へ使うと正当に小さいページ（短文詩・署名頁）で body へ落ちる — 実データ（qa.smbc + 一般記事 + 短文頁）で検証し、必要なら段別閾値へ分離する判断をこの PBI に追記する
- **ノイズ混入リスク（深掘りで受容）**: body フォールバックは nav/footer/広告を本文に再導入し、要約が濁る回帰を起こし得る。正常ページの byte pin だけでは検出しきれないため、手順8の検証で「ガード発火後の送信本文の品質」も対象にする。デフォルトONの前提条件としてこのリスクを明示する

## 関連PBI
- [2026-09-22-04-feat-ai-summary-regenerate.md](2026-09-22-04-feat-ai-summary-regenerate.md)（治療）: **本 PBI 完了後に着手**（深掘り 2026-09-22 確定）。04 の GET_CONTENT 再生成経路でも本 PBI のガードは発火させる（統一）。発火条件・閾値語彙は 04 が引き継ぐ

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）
```bash
rg -n "applyFallback|overCleansed|aiSummaryOriginalBytes" src/utils/contentExtractor/
rg -n "cleanseContent|stripKeywordElements|collectKeywordElements" src/utils/contentCleaner.ts
rg -n "scoreAndSort|candidates.length|findMainContentCandidates" src/utils/contentExtractor/
rg -n "FALLBACK_RATIO|FALLBACK_MIN_BYTES|BODY_PROTECTION" src/
```
- 既実装なしを 2026-09-22 に確認済み。ただし実装開始時に再grepすること
- archived `2026-08-24-02-refactor-content-extractor-fallback.md` と `2026-08-30-01-feat-cleansing-readability-scoring.md` を目視し、fallback / scoring の既存意図と矛盾しないか確認する

### 実装手順
1. **再現確認を PBI 04 と共有**: `qa.smbc.co.jp` の切り分け（①主因か / body.innerText 復元か / whitelist か / `page_bytes` の script 汚染か）を先に確定し、本 PBI の背景に追記
2. RED: 極小候補 fixture（トップ候補 < 300 B の FAQ）を作り、現状 193 B 送出を e2e で実測
3. `applyFallback` 拡張: `FallbackInput` に②pair を追加、`overCleansed` 必須条件を一般化。**③既存経路 byte-identical pin を先に書く**
4. ②復元: **抽出末尾の `applyFallback` 単一呼び出しに ②pair を追加**（cleanseContent 直後の早期判定はしない — Ask 2026-09-22 の single copy 決定に従う）。winner は ② > ③ > 短文の優先順で型/テストに固定し、②winner 時は ③pair 無効化
5. ①検査: 候補選択後 `< fallbackMinChars`（Ask Q3B・文字数 knob。旧記載の `fallbackMinBytes` は誤り — Phase 4 修正）→ 全滅で body path 既存分岐へ合流。**スキャンは take 切り前のスコア順全リストに対して行う**（article/main 分岐の take=1 切り後では2位以降が見えず走査が空振りするため — Phase 4 決定）
6. 設定配線: `fallbackRatio` 共通化 + **新 `fallbackMinChars` knob（StorageKey + UI入力）** + **①②の2 flag（新 StorageKeys）+ AI要約クレンジングパネル「過剰削減ガード」セクション（i18n ja/en）**
7. pin: 正常ページ byte-identical・flag OFF byte-identical・③設定非影響
8. グリーン後、実データで閾値検証（**自動: qa.smbc 再現 fixture / over-cleansed-page / 短文頁 fixture / whitelist 対象外。手動: qa.smbc 実サイト（下記チェックリスト）**）し、段別閾値へ分離するかの判断を背景に追記 — **この検証完了は DoD ゲート（Why 連鎖J + Ask N2-A）**

### 落とし穴
- ~~`overCleansed` の必須条件を緩めるとき、③既存の `over_cleansed` 復元と二重発火する~~ **（Ask 2026-09-22 解消）** — `applyFallback` 1箇所・両ペア優先順（② > ③ > 短文）で winner を構造的に決定。判定の2箇所分割はしない
- `page_bytes` に script text が含まれるため①に比率を使うと過剰発火（技術的考慮事項参照）
- `settleFallback` は short_content 復元時に AI 計測を破棄する（実例の「計測なし」原因の一つ）— ②復元ではこれを再現しない（②pair は診断に保持して出す）
- hot path に `getByteSize` を追加しない（meter 無効時は文字数比較）
- `scoreAndSort` の `take=3` 経路（複数候補を返す枝）で検査対象が1位のみか全候補かを決める
- `DEFAULT_CLEANSE_BODY_PROTECTION_THRESHOLD`（200）と `DEFAULT_BODY_SCORE_THRESHOLD`（120）は既存の意図的な非対称 — 本 PBI では触らない

## 深掘りセッション — 2026-09-22

### 挑戦した仮定
| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| デフォルトONで全記録に効かせてよい | 高・実現可能性/プロダクト | 閾値（300B/20%）は実データ未検証。body フォールバックは nav/広告ノイズを再導入し得る（餓死193B vs ノイズ混入） | **デフォルトON維持** — 文言対称性・即効性を優先。リスクは段別flag + 手順8の実データ検証で吸収 |
| 04/05 の実装順 | 高・依存関係 | RICE 05>04、両者 contentExtractor 周りを触り衝突リスク | **05 先行** |
| 緩和再生成へのガード発火 | 高・依存関係 | 04 の GET_CONTENT 経路にも発火 | **緩和中も発火（統一）** — クレンジング緩和（送信前処理）とガード（抽出品質）は非干渉の別軸 |
| 段別 flags は v1 必須 | 中・スコープ | デフォルトON確定によりロールバック手段として必須性が増した | **flags 維持（①②の2個・Ask 2026-09-22）** |
| ②③の判定構造 | 高・アーキテクチャ | 二重発火リスク（落とし穴）が未裁定だった | **applyFallback 1箇所・両ペア優先順（② > ③ > 短文）（Ask 2026-09-22）** |
| flag の配置先 | 中・UI | 既存閾値スライダーは AI要約クレンジングパネルにある | **同パネルに「過剰削減ガード」新セクション（Ask 2026-09-22）** |

### 新たに発見したリスク
- ノイズ混入: body フォールバック導入で nav/footer/広告が本文に混ざり要約が濁る回帰。正常ページ byte pin だけでは検出しきれない
- 04 より先に実装されるため、04 の GET_CONTENT override 契約と本 PBI の発火条件を先に整合させる必要

### 未解決の疑問
- 段別閾値（①②で `fallbackMinChars` を共有するか分離するか）は手順8の実測後裁定
- （解消 2026-09-22 Ask）段別 flag の実数・配置 → ①②の2個・AI要約クレンジングパネル新セクション
- （解消 2026-09-22 Ask/Why）whitelist → v1 対象外（将来候補として追跡）/ 単位ずれ → `fallbackMinChars` 新設
- 将来の 04 一括再生成（v1対象外）が入った場合のガード連動・コスト制御

### 決定事項
1. デフォルトON（現状案どおり）+ 段別flagロールバック
2. 実装順: 04 より先に本 PBI を着手
3. 緩和再生成でもガード発火（統一）
4. 段別 flags は v1 必須
5. **②③判定構造 = applyFallback 1箇所・両ペア優先順（② > ③ > 短文）で winner 決定**（Ask 2026-09-22）
6. **段別 flag = ①②の2個のみ、配置 = AI要約クレンジングパネル「過剰削減ガード」新セクション**（Ask 2026-09-22）
7. **whitelist = v1 ガード対象外（Ask Q2A 2026-09-22）**
8. **絶対量 hot path = 文字数 knob `fallbackMinChars` 新設・`fallbackMinBytes` は③と診断に分離（Ask Q3B 2026-09-22）**

### 技術裁定（Ask 不要・実装時にこの通り）
- fallback reason 新値: `candidate_too_small`（①）/ `content_overcut`（②）。既存 `short_content` / `over_cleansed` 不変。i18n 両言語追加（04 と共通の語彙）
- ①走査: `findMainContentCandidates` のスコア順リスト先頭から閾値充足候補を採用、全滅で body path（**textContent 系 candidate-zero 分岐・short_content の innerText 復元とは別 — Why 連鎖G**）。hot path は `fallbackMinChars` 文字数比較のみ（byte エンコードしない）
- ②復元 winner 時は ③pair 無効化（既存 `settleFallback` の計測破棄フローと同型）。③の削除も同時に巻き戻る（ノイズ込み・餓死よりマシ — Why 連鎖M）
- take=3: スコア順全走査は scoring 意図を壊さない（1位不足時の2位採用は改善・全滅は既存 body 分岐と同一 — Why 連鎖O）

### なぜなぜ分析 — 2026-09-22（ Why 連鎖 E/F/G/J/M/O 反映）

| 連鎖 | 結論 |
|------|------|
| E: whitelist 死角 | **Ask Q2A**: v1 は whitelist ガード対象外。保証は blacklist/body 経路限定と受入基準・ドキュメントに明示 |
| F: bytes/文字数 単位ずれ | **Ask Q3B**: 文字数専用 knob `fallbackMinChars` 新設（+1 SP）。`fallbackMinBytes` は③と診断に分離 |
| G: ①合流先 | **解**: candidate-zero の textContent 系（accordion 隠し本文を含む）— short_content の innerText 復元とは別経路 |
| J: pin の限界とリリースゲート | **解**: 手順8の実データ閾値検証を DoD ゲートに明記 |
| M: ②復元の安全性 | **解**: ③削除も同時に巻き戻る（ノイズ込み）が餓死よりマシと技術的考慮に明記 |
| O: take=3 全走査 | **解**: スコア順維持で妥当（裁定どおり） |

## 深掘りセッション — feature-dev Phase 2b（2026-09-22）

### 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| DoD ゲート「手順8の実データ検証（qa.smbc 含む）」を自動で完了できる | 高・実現可能性 | qa.smbc.co.jp は外部サイト — 実アクセスはネットワーク+手動操作依存。over-cleansed / 短文頁 / whitelist はローカル fixture で再現可能 | **fixture 自動検証 + qa.smbc は手動チェックリスト化（Ask N2-A）** — 手順8の自動部分は `testDir/e2e/test-pages/` fixture（qa.smbc 再現ページを含む）で実施し、DoD の「検証完了」は fixture 結果 + **qa.smbc 手動確認チェックリスト（PBI 末尾に追加）** の二本立てに変更。実サイト e2e は行わない |

### 新たに発見したリスク
- （なし — 05 の実装面は Phase 2 調査で旧 dig の前提がすべて確認された）

### 未解決の疑問
- 段別閾値（①②で `fallbackMinChars` 共有 or 分離）は従来どおり手順8実測後裁定（fixture 実測で early に判断可能）

### 決定事項
1. **DoD ゲート = fixture 自動検証 + qa.smbc 手動チェックリスト**（実サイトへの自動アクセスはしない）

### qa.smbc 手動確認チェックリスト（DoD ゲート用）
- [x] 拡張をロードした実ブラウザで `https://qa.smbc.co.jp/faq/show/7622?site_domain=default` を通常記録する
- [x] 診断行で①候補選択の削減が `fallbackMinChars` ガードで body path にフォールバックしたことを確認（fallback reason = candidate_too_small）
- [x] 送信本文が 193 B ではなく十分な長さになり、要約が「個人および法人に関する内容です。」より豊富になったことを確認
- [x] flag を OFF にすると旧挙動（193 B 送出）に復帰することを確認
- [x] 結果（日付・実測値）をこの PBI の背景に追記 — v6.9.16 リリース後の実運用（CHANGELOG 記載）により実施済み扱いとする（2026-09-24 arch-delivery-loop 台帳消化時にユーザー確認）

## 実装結果 — 2026-09-22（Phase 5）

- **自動 DoD ゲート: 完了**
  - fixture 自動検証: `src/utils/contentExtractor/__tests__/overcutFixtures.test.ts`（qa-smbc-repro=① `candidate_too_small` body join + フロア充足・keyword-overstrip=② `content_overcut` 復元・whitelist-tiny=ガード非発火の明示）— **qa-smbc は既定設定フル構成（55キーワード+全ルール）で実行**
  - e2e: `testDir/e2e/overcut-guard-recording.spec.ts` **PASS**（実 content script: consent → report → ①発火 → legacy metadata fallbackTriggered=true + content≥100 → SQLite row。port1234 は host_permissions の AI ポートを流用 — localhost:8080 は権限不足で sender.tab.url が隠蔽されるため）
  - 単体: applyFallback境界 pin 6 + ②マトリクス 7 + scoring ガード 4 + index ①新旧 + kernel 通知2 + 設定ラウンドトリップ 3 + presentation reason 2（validate 全体 13,052 緑）
- **実装中に発見した既存挙動（本PBIのスコープ外・観察記録）**: 既定キーワード `'age'` が `[class*="age"]` の**部分文字列**マッチで class `page-body` を丸ごと Keyword Strip する（'language'/'message'/'package' 等も同様に脆弱）。fixture は class 名を `content-column` に変更して回避。**word-boundary マッチング改善は将来候補（別PBI）** — 現行仕様の byte-identical 方針上、本PBIでは変更しない
- **残る DoD**: qa.smbc 実サイト手動チェックリスト（上記）— ユーザー実行待ち
- **Phase 7 レビュー（3体）で修正したもの（05関連分）**: 文字数フロアの `min:1`（0=①OFF/②比率のみという曖昧さを排除）/ `fallback_reason` の読み取り到達（`SEARCH_COLUMNS` + FTS/LIKE 直書き SQL + legacy patch + enrichment — light list / 検索結果でも「フォールバック理由」行が表示される）/ migrationBackup の列位置脆さ（`MIGRATION_BACKUP_COLUMNS` 基準の index + legacy 列は明示 null）/ scoring の3枝重複を `scanAndAdopt` に集約 / overcut e2e のポート probe-pick + bind 待機（固定1234は実 LM Studio と衝突）/ HTML の save ボタン i18n 復元・チェックボックスの `aria-describedby` / docs に日本語 half 追記・PBI ID 除去



- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 正常ページ byte-identical pin・flag OFF byte-identical・③既存テスト無修正でパスする
- [x] 段別 flag OFF で旧挙動完全復帰をテストで pin した
- [x] **手順8の実データ検証が完了している — 自動部分は fixture（qa.smbc 再現 / over-cleansed / 短文頁 / whitelist 対象外）で実施し、残る qa.smbc 実サイト確認は上記「qa.smbc 手動確認チェックリスト」を消化して結果を背景に追記（リリースゲート・Why 連鎖J + Ask N2-A 2026-09-22。実サイトへの自動アクセスは行わない）**
- [x] `npm run validate` と `npm run build` が通る
- [x] コードレビュー完了（GitHub PR approve 必須。**デフォルト ON の全記録挙動変更**であることを PR 説明に明記）
- [x] リファクタリング完了（グリーン後）
- [x] ロールバック手段の検討完了（段別 flags）
- [x] ドキュメント更新済み（`docs/CLEANSING_ORDER.md` / `docs/AI_SUMMARY_GUIDE.md` にガード節、「過剰削減フォールバック」文言が①②③に効くことを明記、CHANGELOG）
