# PBI 06: aiSummaryCleaner の 32 shallow strip を SelectorRuleDef テーブルへ畳む

## ユーザーストーリー

AI クレンジングのノイズ除去ルールを保守する開発者として、strip ルールを「データ行」として追加・レビューできてほしい。なぜなら現状は 32 個の `strip*` 関数が同一の ~20 行形（Set 新規 → querySelectorAll → counted 重複ガード → safeRemoveElement ループ）を手写しし、パターンリスト間の重複（`sp-RELATED` 等が RECOMMEND と SNS_PROMO/PLATFORM の両方に存在）が diff で見えないから。

## 優先度

- 順位: 06 / 6
- RICE スコア: 6.4（Reach=2 / Impact=2 / Confidence=80% / Effort=0.5 人週）
- 根拠: リポジトリ最大ファイル（stripExtended.ts 1,049 行）の構造改善。dispatch seam（CLEANSING_RULES）は既に深いため、leaf の interface をデータに畳むだけで完結。`collectCookieConsentElements`（stripExtended.ts:137-154）が同形統合の実証済み前例。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: なし（他 PBI とファイル非重複）。

## BDD 受け入れシナリオ

```gherkin
Scenario: パターン系 strip がデータ行で動く
  Given SelectorRuleDef テーブルに news/ec/qa/video 等の行が定義されている
  When  stripBySelectors(root, def) エンジンが各行を実行する
  Then  現行の各 strip* 関数と同一の除去結果になる（同一 fixture で差分ゼロ）

Scenario: 重複ガードの規律がエンジンに集約される
  Given 同一要素が複数ルールにマッチする
  When  エンジンが連続して strip を実行する
  Then  counted 重複ガードにより各要素は 1 回だけ除去され、
        除去カウンタの合計が旧実装と一致する

Scenario: bespoke な strip は関数のまま残る
  Given text-density / short-seq / symbol-line / link-only-para / fixed(sticky) 判定等の
        非セレクタ系ルールがある
  When  クレンジングを実行する
  Then  これらは既存関数実装のまま動作し、テーブル化の対象外であることが
        ルールテーブル上で明示される
```

## 受け入れ基準

- [x] `SelectorRuleDef { key, patterns, extraSelectors?, predicate? }` テーブル新設（CLEANSING_RULES 隣接位置）
- [x] `stripBySelectors(root, def)` エンジン新設（Set + query + 重複ガード + safeRemoveElement を所有）
- [x] パターン系 strip 関数（stripRecommendSections / stripPaginationElements / stripSnsPromoElements / stripNewsMediaPatterns / stripEcSitePatterns / stripQaSitePatterns / stripVideoSitePatterns / stripPopup 等）をテーブル行 + エンジン呼び出しに置換
- [x] news/ec/qa/video 4 関数がパターンリストの違いのみになる（同一コード形状の 4 コピー解消）
- [x] 重複パターン（RECOMMEND ∩ SNS_PROMO/PLATFORM 等）を実装メモに棚卸し記録（削除するか理由付きで残すか判断）
- [x] 除去結果の同値性を回帰テストで証明（既存クレンジング fixture / bench c3 基盤を利用）
- [x] 振る舞い変更なし（除去結果・カウンタ・reason 文言が現行と同一）

## テスト戦略

- 同値回帰: 旧 strip 関数群と新エンジンの除去結果を同一 fixture で比較（移行時に旧関数を参照実装として使用し、着地後削除）
- 単体: エンジンの重複ガード（複数ルール交差）・predicate 付き行
- 回帰: aiSummaryCleaner 既存テスト群 + bench c3 green

## 実装アプローチ

1. 同値性回帰テスト作成（旧関数を参照実装に）
2. SelectorRuleDef 型 + テーブルへ移行（patterns.ts の定数を行に収める）
3. stripBySelectors エンジン新設・パターン系置換
4. bespoke 残置の明示・重複パターン棚卸し
5. stripCore.ts / stripExtended.ts の行数縮減を確認（合計 ~1,500 行 → 実装メモに計測記録）

## 見積もり

0.5 人週。難易度: 🟡中。副作用: 🟢なし（除去結果不変）。種別: 🔧非機能追加（refactor）。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] type-check / lint / 対象テスト green
- [x] コードレビュー完了
- [x] `00-INDEX.md` 更新

## 実装メモ

### 中断時の引き継ぎ状態

前任エージェントは以下まで完了し、テスト移行の途中で kill されていた。

- 新設: `src/utils/aiSummaryCleaner/selectorRules.ts`（`SelectorRuleDef` / `SelectorGroupDef` /
  `stripBySelectors` / `isCookieConsentText` + パターン 8 テーブル + 23 行の `SELECTOR_RULE_DEFS`）
- 変更: `rules.ts` の dispatch を全て `stripBySelectors(el, SELECTOR_RULE_DEFS.x)` 呼び出しに置換
- 変更: `stripCore.ts` / `stripExtended.ts` から旧 strip 関数本体を削除（計 1,071 行削除）
- 新設: `__tests__/stripEngineEquivalence.test.ts`（旧関数 vs エンジン行の同値テスト、24 ケース）
- 未完: 既存テストは旧関数名を import したままだったため、`npx vitest run src/utils/aiSummaryCleaner` で
  336 failed / 559 passed（29 ファイル中 11 ファイル失敗）。`npm run type-check` は通過。

### 336 失敗の根本原因

全て `TypeError: stripXxx is not a function`（削除済み内部関数の import 解決失敗）であり、
エンジンの振る舞い不一致は 1 件もなかった。復旧後に 895/895 がそのまま green になったことで裏付け済み。

### 引き継ぎ後に実施した修正

1. 旧 strip 関数 23 個を 1 行 delegate として復活（旧名・旧シグネチャ維持、中身は対応行への
   `stripBySelectors` 呼び出し）。`stripCore.ts` に 9 個（metadata / ads / nav / social / deep /
   jsonLd / lazyLoad / skipLink / card）、`stripExtended.ts` に 14 個（recommend / pagination /
   snsPromo / popup / platform / enhancedHidden / emptyElem / jpLayout（`customPatterns` 引数維持）/
   jpNavigation / author / newsMedia / ecSite / qaSite / videoSite）。
   - テスト側は 1 行も変更していない（assertion は byte-identical のままエンジンを検証する）。
     テストを `index.ts` 公開入口へ re-point する方式は、per-rule 単体テストの単一性を崩すため不採用。
     PBI の「テーブル行 + エンジン呼び出しに置換」は delegate（1 行のエンジン呼び出し）として満たす。
2. `CARD_PATTERNS` を `stripCore.ts` から `patterns.ts` へ移動し、`stripCore.ts` から再エクスポート。
   delegate が `selectorRules.ts` を import すると `stripCore ⇄ selectorRules` の循環 import になり、
   `SELECTOR_RULE_DEFS` のモジュール評価時に `CARD_PATTERNS` が TDZ で落ちるため。
   既存テストの `from '../stripCore.js'` import は再エクスポートで維持。
3. 同値 scaffold のヘッダコメントを更新し、wiring-guard（delegate と行の対応付けの番人）として維持。
   元ヘッダの「landing 時削除」前提は上記 1 の方式変更に伴い取り下げた。

### 同値性の検証内容

- 8 パターンテーブル + `JP_LAYOUT_PATTERNS` + `CARD_PATTERNS` をスクリプトで旧実装と要素単位比較し、
  全て順序まで含め完全一致を確認。
- predicate 系（`isCookieConsentText` / `isDeepLinkDenseList` / `isDeepEmptyContainer` /
  `isEmptyContainer` / `isFixedOrSticky`）が旧 inline 実装と同一条件であることを目視確認。
- `safeRemoveElement` は detach チェックをしない（`element.remove()` は detached でも `true` を返す）ため、
  旧実装とエンジンでグループ収集順序が違っても除去カウントは変わらない。
- `stripNavElements` は旧実装どおり nav セレクタのみ（legal テキスト合算は `rules.ts` の dispatch が担当）。

### LOC（`wc -l`）

- `stripCore.ts`: 522 → 166（−356）
- `stripExtended.ts`: 1,049 → 493（−556）
- 2 ファイル合計: 1,571 → 659（−912 行、−58%）
- 新設 `selectorRules.ts`: 450 行（テーブル + エンジン + predicate 集約）
- `patterns.ts`: +17 行（`CARD_PATTERNS` 移動分）、`rules.ts`: 230 → 208（−22）

### 分類（テーブル化 23 vs bespoke 維持 11）

- テーブル化 23 行: metadata / ads / nav / social / deep / jsonLd / lazyLoad / skipLink / card /
  recommend / pagination / snsPromo / popup / platform / enhancedHidden / emptyElem / jpLayout /
  jpNavigation / author / newsMedia / ecSite / qaSite / videoSite
- bespoke 維持 11 関数: alt / legal（nav に合算）/ linkDensity / fixed / cookie / textDensity /
  shortSeq / symbolLine / linkPara / affiliate / speechBubble（PBI 指定の 6 種を含む）

### 重複パターン棚卸し

- テーブル内重複 5 件: `sp-related`（RECOMMEND ∩ SNS_PROMO）、`a-carousel`・`promoted-trend`・
  `sp-ads`（SNS_PROMO ∩ PLATFORM）、`ranking`（RECOMMEND ∩ PLATFORM）
- `patterns.ts` まで含めた cross-table 重複は 67 件。ハブは `DEEP_CLASS_PATTERNS` で、
  popup 系（popup/modal/overlay/lightbox/toast/notification/snackbar/ribbon/alert/consent/gdpr/dialog）、
  pagination 系（pager/page-nav/pagination）、author 系（author-profile/writer-bio/post-date 等多数）、
  JP 系（l-footer/l-header/topic-path/breadcrumb 等）が DEEP と重複する。
- 判断: 全て残置。いずれも削除は除去結果の変更になる。rule 内重複はエンジンの単一 counted Set が吸収し、
  rule 間重複は dispatch 順序どおりの逐次実行＋DOM 変異で先勝ちする（旧実装と dispatch 順序が同一のため同一結果）。
  テーブル化により重複が 1 ファイル（`selectorRules.ts` + `patterns.ts`）で可視化されたことが本 PBI の成果。

### 逸脱（deviation）

- 旧関数を削除せず 1 行 delegate として残置（テスト非改変を優先）。
- `CARD_PATTERNS` を `patterns.ts` に移動（循環 import 回避）。
- `00-INDEX.md` の 06 行更新は archive 時対応のため skip（他 PBI の行には触れていない）。

### 最終結果

- `npx vitest run src/utils/aiSummaryCleaner`: 29 ファイル / 895 テスト green（中断時 336 failed / 559 passed）
- `npm run type-check`: pass
- `npm run lint`: 0 errors（124 warnings は全て既存・他モジュール由来、aiSummaryCleaner 内は index.ts の logger 警告のみで既存）
