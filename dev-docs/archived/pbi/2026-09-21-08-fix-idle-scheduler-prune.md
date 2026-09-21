# PBI: IdleScheduler の発火後タイマー id を追跡 Set から除去する

## ユーザーストーリー
開発者として、IdleScheduler が発火済み one-shot タイマーの id を追跡 Set から除去してほしい、なぜなら発火後も id がページ生存中ずっと Set に残留し長命 SPA タブで緩慢に増加するから

## 優先度
- 順位: 7
- RICEスコア: 8.0（Reach=4 / Impact=0.5 / Confidence=100% / Effort=0.25週）
- 根拠: 機能バグではなくメモリ衛生の問題のため Impact は 0.5 に留まるが、修正範囲が IdleScheduler の schedule 経路に限定され Effort が 0.25週と小さい。確度は証拠コードで確定しているため Confidence は 100%

## ビジネス価値
長命 SPA タブにおける Set の緩慢な増加が止まり、ページ生存中のメモリ衛生が保たれる。cancel の意味論は変わらず、既存の周期チェック・遅延 untrusted-scroll チェックの振る舞いに影響を与えない

## BDD受け入れシナリオ

```gherkin
Scenario: 発火済み timeout id は追跡 Set から除去される
  Given delayMs 付きで schedule された callback がある
  When callback が発火する
  Then timeoutIds に対応する id が残留しない

Scenario: 発火済み idle id は追跡 Set から除去される
  Given requestIdleCallback 経路で schedule された callback がある
  When callback が発火する
  Then idleIds に対応する id が残留しない

Scenario: cancel 済み id への二重 delete は安全である
  Given schedule 後に cancel された id がある
  When 発火タイミングが到来する
  Then 例外なく何も起きない
```

## 受け入れ基準
- [x] 発火時に自身の id が対応する Set から delete される
- [x] cancel の意味論が維持される（cancel 済み id の二重 delete が安全）
- [x] delayMs 経路と requestIdleCallback 経路と fallback 経路の全てが対象になる
- [x] fire-then-prune と cancel 後挙動のテストが新設され green である
- [x] 既存の周期チェック・遅延 untrusted-scroll チェックの振る舞いが変わらない
- [x] 長命 SPA タブで発火済み id が Set に残留しない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（内部メモリ衛生の修正）

### 統合テスト
- schedule から発火までの経路で Set 残留が起きないこと（delayMs 経路・idle 経路）

### 単体テスト
- fire-then-prune: 発火後に timeoutIds / idleIds から id が消える境界
- cancel 後挙動: cancel 済み id の発火時 delete が例外なく安全である境界

## 実装アプローチ
- **Outside-In**: 発火後に Set から id が消えるテストを先に書き、Red で callback ラッパーを導入する
- schedule 内で callback をラップし、実行直前または直後に対応する Set から自身の id を delete する
- cancel の実装は変更せず、delete の冪等性により二重 delete を安全に吸収する

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 他 PBI とは独立。IdleScheduler の schedule 経路のみに影響する
- 非機能要件: 発火タイミング・callback の実行順序・cancel の取り消し意味論を変更しない
- 非機能要件: 例外時の delete 漏れを避けるためラッパー内で確実に prune する

## 実装者向け注記

### 現状の証拠
- `src/content/contentKernel.ts:34-36` — IdleScheduler が `timeoutIds` / `idleIds` の2つの Set で追跡する
- `src/content/contentKernel.ts:40-55` — schedule が `timeoutIds.add`（delayMs 経路・fallback 経路）と `idleIds.add`（requestIdleCallback 経路）を行う
- `src/content/contentKernel.ts:57-83` — 現状の delete は cancel 経路のみで、発火経路に cleanup が存在しない
- `src/content/contentKernel.ts:426-429` — 発火済み one-shot の一例（遅延 untrusted-scroll チェック）。周期チェックと同様に発火後も id が残留する

## Definition of Done
- [x] 全BDDシナリオ実装+パス
- [x] コードレビュー完了
- [x] 統合検証 green
