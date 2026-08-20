# PBI: TrustDecision Seam — 4モジュール往復を1つの判断 moduleに

## ユーザーストーリー
開発者として、`isTrusted(url) → Decision` の1メソッドだけを知ればドメインの信頼判定が完結する深い `TrustDecision` module がほしい、なぜなら現在は `isDomainTrusted` を呼ぶたびに `trustDb → permissionManager → ManagedStringList → domainUtils → extractDomain` と4モジュールを往復し、seam が分散して呼び出し元がどのモジュールのどのメソッドを呼ぶべきかを知る必要があり、`trustDb` 558行の interface は `isTrusted`/`add`/`remove` が薄く広く、真のバグは呼び出し順に潜むから

## 優先度
- 順位: 04 / 05
- RICEスコア: 857（Reach=500 / Impact=2 / Confidence=60% / Effort=0.7）
- 根拠: Reachは信頼判定利用者（500/1000）、Impactは大きい（プライバシー判定の誤りは重大）、ConfidenceはADR 2026-03-20の分離が再発しているため低め、Effortは4モジュールの集約で0.7人月。依存はSettingsRepositoryの `TrancoVersionTracker` と一部重なるが独立して着手可能。

## なぜなぜ分析
- **疑問**: なぜ 4モジュールを往復する必要があるのか → なぜ: 信頼判定の責務が `trustDb`/`permissionManager`/`ManagedStringList`/`domainUtils` に分散し、単一の seam が無いから
- **なぜ** `permissionManager ↔ trustDb` の責務が曖昧なのか → なぜ: ADR 2026-03-20で分離したが、運用で再び密結合し、どちらが正のリストを管理するかが不明確になったから
- **解**: `TrustDecision` の seam に `TrustDb`/`PermissionManager`/`DomainFilter` を adapters として注入し、`isTrusted(url)` の1 seam で完結させる

## BDD受け入れシナリオ
Scenario: 信頼判定が1 seamで完結する
  Given 任意の `url`
  When `trustDecision.isTrusted(url)` を呼ぶ
  Then Tranco / 許可リスト / 拒否リスト / permission を総合した `Decision` が返る

Scenario: 許可リスト追加が1箇所で完結する
  Given 新しいドメインを許可リストに追加する
  When `trustDecision.addToAllowlist(domain)` を呼ぶ
  Then `ManagedStringList` の内部状態が更新され、次回の `isTrusted` で反映される

Scenario: 3種類の送信元 × 信頼レベルが網羅される
  Given 19メッセージ型 × 3送信元（content script / 拡張ページ / 外部拡張）
  When `isTrusted` を呼ぶ
  Then 期待される `Decision` が返る（59件の網羅テストと同様）

## 受け入れ基準
- [x] `TrustDecision` の外部 interface が `isTrusted(url)` に集約されている
- [x] `TrustDb` / `PermissionManager` / `DomainFilter` が adapter として注入可能である
- [x] `ManagedStringList` が internal seam に格下げされている
- [x] 既存の59件の trust 網羅テストが `isTrusted` 越しにパスする

## テスト戦略
- E2E: 実際のページで `isTrusted` → 記録可否の判定を検証
- 統合: `TrustDecision` + 実 `TrustDb` + `PermissionManager` で協調動作を検証
- 単体: 各 adapter は internal seam として `isTrusted` 越しに間接的に検証

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（ADR 2026-03-20の矛盾点を追記）
- [x] 4モジュール往復が `grep` で検出されないこと

## 補足
- ADR 2026-03-20 `permissionManager-trustDb-separation` と矛盾するが、摩擦が再発しているため再検討の価値ありとして明示する。
