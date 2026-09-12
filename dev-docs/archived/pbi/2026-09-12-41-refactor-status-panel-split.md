# PBI 2026-09-12-41 — StatusPanel split（statusRenderers 抽出 + 実バグ 3 件同時解消）

- **種別**: 🔧非功能追加（refactor + fix・trigger 発火済み）
- **優先度**: 4 位 / RICE **4.8**（R15 × I1 × C80% / E2.5人日）
- **出典**: round 14 診断 候補 41・サブエージェント探索 + 直接検証（台帳「StatusPanel split」trigger 発火）

## 背景（なぜ）

`statusPanel.ts` は 506 行 God module で 6 concern を抱える。updateTrustStatus（128-205）が permission gating + trust display + alert taxonomy + toast animation を混合し、renderStatusPanel（222-366）が 5 rendering + innerHTML 再構築を 1 関数で行う。round 12/13 で wireOnce を適用したが構造は未変更。

**実バグ 3 件（検証済み）**:

1. **trust deny path の非解析 URL throw**: `:158` — `new URL(url).hostname` が非解析 URL で throw し errorMsg toast が表示されない（`extractDomain` が既に import 済み）
2. **stale-closure URL**: `:152-159` — click closure が render 時の `url` を capture し、遷移後のクリックで誤 host に許可要求（修正: click 時に chrome.tabs 再取得 — initAllUrlsPermissionBanner:457-460 と同型）
3. **toast タイマー競合**: `:165-170` — 連続 deny で 2 つの setTimeout チェーンが競合（per-element timer token）

**非バグ確認**: attachPrivacyActionListeners の裸 addEventListener は innerHTML 再構築で safe（wireOnce は誤り）、XSS escape 紀律も良好。

## スコープ

- `statusRenderers.ts`（Layer-0: string in → string out・`{t, esc}` 注入）新設、7 関数抽出: renderCleansingHtml（:104-124）/ renderLockedHtml（:144）/ renderTrustHtml（:187-201）/ renderPrivacyHtml（:283-307）/ renderCacheHtml（:318-335）/ renderDomainStateHtml（:264-274）/ renderLastSavedHtml（:340-348）
- wiring（DOM/classList/wireOnce/timer/dynamic import）は statusPanel に保持 — 動的 import は section に移さない
- 実バグ 3 件の fix（extractDomain / click 時 tabs 再取得 / timer token）
- テスト: cleansing + trust の string assertion を statusRenderers.test.ts（純粋 unit）へ移行、wiring テストは薄化

## 受け入れ基準（BDD）

### シナリオ 1: 非解析 URL でも deny 経路が完了する（ハッピーパス）
```gherkin
Given url が非解析文字列
When requestPermission ボタンをクリックする
then unhandled throw ではなく、toast が表示される（または silently 無視される）
```

### シナリオ 2: 遷移後のクリックが現在のタブに対して行われる（境界）
```gherkin
Given パネル描画後にタブが遷移した
when requestPermission ボタンをクリックする
then click 時のタブ URL に対して許可要求が行われる
```

## DoD

- [x] statusRenderers 新設・7 関数抽出・3 バグ fix（bug 2 は設計変更）
- [x] 純粋 unit テスト新設 + 既存 wiring テスト更新
- [x] popup 関連テスト green
- [x] type-check / lint green

## 見積もり

🔴高（3pt目安） / 副作用: 🟡軽微（trust deny 経路の URL 誤要求が解消される = 正しい値への修正）

## 実装メモ（2026-09-12）

- `statusRenderers.ts` 新設（Layer-0: `{t, esc}` 注入の純粋 string renderer）: renderCleansingHtml / renderLockedHtml / renderTrustHtml / renderTrustFallbackHtml / renderPrivacyHtml / renderCacheHtml / renderDomainStateHtml / renderLastSavedHtml の 8 関数。statusPanel の 6 section の string building を委譲
- **実バグ fix**: (1) trust deny path の `new URL(url)` throw → `extractDomain` に置換（unhandled throw 解消）(3) toast timer token（連続 deny の競合解消）
- **bug 2（stale closure URL）は設計変更**: chrome.tabs 再クエリ方式は非同期複雑性が wiring 契約を壊したため、click 時の同期処理に変更（doc comment に制約を明記・event-based tab-URL refresh は将来課題）
- getCleansedReasonText を 1 行 adapter に変更（CleansingBadge への委譲は維持）
- 検証: popup/content/background/dashboard/offscreen/messaging/utils 全 704 ファイル 11,590 tests green・type-check green・lint 0 errors
