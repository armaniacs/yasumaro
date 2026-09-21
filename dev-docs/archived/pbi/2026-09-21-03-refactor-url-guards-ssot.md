# PBI: URL 判定・正規化の SSOT 迂回（isSecureUrl・HeaderDetector.normalizeUrl）を委譲に統一する

## ユーザーストーリー
開発者として、URL 判定と正規化の重複実装を SSOT への委譲に統一したい、なぜなら同一ルールの別実装が層を跨いで使われていると scheme・slash・hash の意味論が二箇所でずれ始め、リンク XSS 隣接の描画ガードと全記録経路の判定に矛盾が混入するから

## 優先度
- 種別: refactor
- 順位: 2
- RICEスコア: 16.0（Reach=4 / Impact=2 / Confidence=100% / Effort=0.5週）
- 根拠: production 呼び出しが描画ガードと記録経路の計8箇所に分散し、意味論ずれが XSS 隣接と記録可否に直結するため Impact は 2。変更は委譲2行と parity テスト新設に限定でき Effort は 0.5週。キャッシュキー意味論の確認は別 PBI に記録済みで、この PBI は委譲統一のみに絞る

## ビジネス価値
URL scheme 判定と正規化の修正点が1箇所に集約される(locality)。scheme 追加・slash・hash 扱いの変更が二重メンテにならず、描画ガードと記録判定の矛盾による取りこぼし・誤記録のリスクが減る

## BDD受け入れシナリオ

```gherkin
Scenario: isSecureUrl が SSOT と同一判定を返す
  Given http/https・chrome/file/data・不正文字列の URL 集合
  When isSecureUrl に各 URL を渡す
  Then isHttpUrl と同一の真偽値を返す(名前と署名は維持する)

Scenario: HeaderDetector.normalizeUrl が SSOT と同一正規化を返す
  Given 末尾スラッシュ付き・hash 付き・ルートパス・パース失敗の URL 集合
  When HeaderDetector.normalizeUrl に各 URL を渡す
  Then normalizeUrlSafe と同一の文字列を返す(hash 除去+末尾スラッシュ除去+失敗時は元 URL)

Scenario: 層を跨ぐ呼び出し側が委譲後の実装で動く
  Given tabEventHandlers と statusChecker の呼び出し
  When それぞれ HeaderDetector.normalizeUrl と normalizeUrlSafe を呼ぶ
  Then 両経路の正規化結果が一致し、既存テストは期待値変更なしで green である
```

## 受け入れ基準
- [x] `isSecureUrl` が `isHttpUrl` への1行委譲になり、名前と署名が維持される
- [x] `HeaderDetector.normalizeUrl` が `normalizeUrlSafe` への委譲になり、static 純粋関数の性質が維持される
- [x] scheme・slash・hash・invalid URL の parity テストが新設され、両ペアの等価を保証する
- [x] 既存 `urlUtils.test.ts` が期待値変更なしで green である
- [x] `headerDetector.test.ts` と `tabEventHandlers.test.ts` が期待値変更なしで green である
- [x] 新規 import が utils→utils の層内依存に収まり、background→utils 以外の逆方向依存を作らない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- 呼び出し側経路の契約: tabEventHandlers(44,75)と statusChecker(121)が委譲後も同一正規化結果を返すこと、contextMenu/recording の記録可否判定が SSOT と一致すること

### 単体テスト
- parity テスト新設: scheme 一覧(http/https/chrome/file/data/javascript)・末尾スラッシュ(ルート/非ルート)・hash 有無・空文字/不正文字列・大文字 scheme の境界
- 既存 suite を回帰網にする: `urlUtils.test.ts`・`headerDetector.test.ts`・`tabEventHandlers.test.ts` は期待値変更なしで green

## 実装アプローチ
- **Outside-In**: まず両ペアの parity テストを Red で書き(現状は実装重複のためテストだけが等価を主張する)、次に委譲2行で Green にする
- `isSecureUrl` は本体を削り `isHttpUrl` 委譲にする(シグネチャ `string => boolean` は維持、呼び出し5箇所は無変更)
- `HeaderDetector.normalizeUrl` は本体を削り `normalizeUrlSafe` 委譲にする(呼び出し側は無変更、cache キー意味論の変更はしない)

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `urlUtils.ts:31-34` に記録の通り、PrivacyCache との統合(キャッシュキー意味論の確認)は別 PBI。この PBI は委譲統一のみで意味論変更はしない
- 遵守すべきルール: utils→utils は層内依存で許容。background→utils の方向を維持し、utils→background の逆依存を作らない
- 非機能要件: 出力 byte 等価。`normalizeUrl`(throw 版)とは意図的に挙動が異なるため混同しない(`normalizeUrlSafe` の非 throw 契約を維持)

## 実装者向け注記

### 現状の証拠
- scheme 判定の重複: `src/utils/urlUtils.ts:54-61` `isSecureUrl` は `src/utils/archiveGuards.ts:58-69` の SSOT `isHttpScheme`/`isHttpUrl`("Single source of truth" コメント付き)と同一ルール(`http:`/`https:` のみ許可、パース失敗で false)の別実装
- `isSecureUrl` の production 呼び出し5箇所: `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:258,508`(リンク XSS 隣接の描画ガード) / `src/background/handlers/contextMenuHandlers.ts:52` / `src/background/handlers/recordingHandlers.ts:191,283`(全記録経路の判定)
- 正規化の逐語重複: `src/background/headerDetector.ts:59-71` `static normalizeUrl`(hash 除去+末尾スラッシュ除去+パース失敗で元 URL 返却)は `src/utils/urlUtils.ts:35-47` `normalizeUrlSafe` と逐語同一
- 統合延期の記録: `src/utils/urlUtils.ts:31-34` のコメントは headerDetector / PrivacyCache の同型実装との統合にはキャッシュキー意味論の確認が必要なため別 PBI と明記(PBI 2026-09-07-24 では popup 側の重複のみ解消)
- 層跨ぎの分散呼び出し: `src/background/handlers/tabEventHandlers.ts:44,75` が `HeaderDetector.normalizeUrl` を使用し `src/popup/statusChecker.ts:121` が `normalizeUrlSafe` を使用。内部呼び出し `src/background/headerDetector.ts:161` も `HeaderDetector.normalizeUrl` 経由
- 既存テスト網: `src/utils/__tests__/urlUtils.test.ts:8-33`(isSecureUrl の scheme 境界) / `src/background/__tests__/headerDetector.test.ts:216-228`(slash/hash/invalid の正規化境界) — 委譲後に期待値変更なしで green であることが回帰条件

## Definition of Done
- [x] 全BDDシナリオが実装されパスする
- [x] コードレビューが完了する
- [x] 統合検証が green である
