# PBI 06: 訪問許可判定を visit-admission モジュールに集約

優先度: 6 位 / RICE 6.7 = (5 × 1 × 80%) / 0.6w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
content script を保守する開発者として、訪問許可の判定（skip→cache→retry 付き background 判定→inject 可否）が 1 モジュールに集約されてほしい。なぜなら現状は 5 小モジュールに分散し、loader が自前の port seam を迂回して直接 import し、retry ループが e2e/normal で複写され、e2e-bypass 安全性がコメントにしかないから。

## BDD受け入れシナリオ

```gherkin
Scenario: 判定が1関数で駆動できる
  Given 注入済み clock/storage/sender の fake
  When  訪問判定を実行する
  Then  chrome なしに skip/cache/retry/inject の全分岐が検証できる

Scenario: e2e cold-cache が background に問い合わせる
  Given e2e cold-cache 状態
  When  判定を実行する
  Then  cache を素通りせず background verdict を retry 付きで取得する

Scenario: 新旧経路の判定が一致する
  Given 同一の domain 設定
  When  loader 経路と kernel 経路で判定する
  Then  両者が同一結果になる
```

## 受け入れ基準
- [x] skip→cache→retry 付き background 判定→inject 可否が 1 モジュール（visit-admission）に集約される
- [x] storage/in-memory の 2 adapter が共有純粋政策関数上の薄層になる（~40 行の分岐重複が消える）
- [x] `domainPolicy.ts`（26 行 shim）が解消される
- [x] loader の IIFE がテスト可能な判定関数になり、e2e/normal の retry 複写が 1 本になる
- [x] `contentKernel.ts:298-305` の pass-through が新 seam 越しになる
- [x] 既存 content suite が green。新規に政策テーブルテストが追加される

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 純粋政策関数の matrix（disabled/whitelist/blacklist × TTL 内外 × e2e 有無）
- retry 回数・e2e-bypass 安全性のテスト
### 統合テスト
- 既存 loader/kernel テストは無修正で green
### 例外ハンドリング
- background 無応答・timeout・不正 URL の経路

## 実装アプローチ
- **Outside-In**: 純粋政策関数から設計 → 2 adapter を薄層化 → loader/kernel を集約呼び出しに → shim 削除

## 見積もり
0.6w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: clock/storage/sender 注入で決定的駆動。loader IIFE の未テスト領域が解消される
- 非機能要件: TTL・retry 回数・blacklist 意味論は不変。e2e の bypass 安全性（cold-cache でも background に問う）を壊さないこと
- MV3 のメインスレッド配慮（.kilorules §5 のバッチ処理）は維持

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '1,134p' src/content/loader.ts
sed -n '1,140p' src/content/domainPolicyPort.ts
```
2026-09-05 時点: loader 134 行（3 分岐＋retry 複写）、port 140 行（分岐重複）、shim 26 行、urlSkipper 78 行。

### 実装手順
1. 純粋政策関数（skip/cache	    policy/retry 回数）を定義
2. 2 adapter を政策関数上の薄層に（1 adapter ずつ green 維持）
3. loader の retry を単一 verdict helper に、kernel pass-through を新 seam 越しに
4. shim 削除 → 政策テーブルテスト追加 → 全 green

### 落とし穴
- e2e-hot-cache（background 問い合わせ省略）は意図的高速路。cold と混同して潰さないこと
- retry 回数・間隔の変更は background 負荷に直結。値を変えず構造だけ変えること
- `urlSkipper` の skip-list は政策関数の入力にし、loader/kernel 両方から同じ関数を通すこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] content 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（domain-filter の層記述 ADR 2026-07-26 との整合を確認）
