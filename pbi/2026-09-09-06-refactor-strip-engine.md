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

- [ ] `SelectorRuleDef { key, patterns, extraSelectors?, predicate? }` テーブル新設（CLEANSING_RULES 隣接位置）
- [ ] `stripBySelectors(root, def)` エンジン新設（Set + query + 重複ガード + safeRemoveElement を所有）
- [ ] パターン系 strip 関数（stripRecommendSections / stripPaginationElements / stripSnsPromoElements / stripNewsMediaPatterns / stripEcSitePatterns / stripQaSitePatterns / stripVideoSitePatterns / stripPopup 等）をテーブル行 + エンジン呼び出しに置換
- [ ] news/ec/qa/video 4 関数がパターンリストの違いのみになる（同一コード形状の 4 コピー解消）
- [ ] 重複パターン（RECOMMEND ∩ SNS_PROMO/PLATFORM 等）を実装メモに棚卸し記録（削除するか理由付きで残すか判断）
- [ ] 除去結果の同値性を回帰テストで証明（既存クレンジング fixture / bench c3 基盤を利用）
- [ ] 振る舞い変更なし（除去結果・カウンタ・reason 文言が現行と同一）

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

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] type-check / lint / 対象テスト green
- [ ] コードレビュー完了
- [ ] `00-INDEX.md` 更新
