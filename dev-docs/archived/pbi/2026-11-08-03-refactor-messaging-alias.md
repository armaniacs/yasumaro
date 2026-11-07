# PBI 2026-11-08-03: messaging alias 三重複製の集約

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 3/9
- RICE: 7 (R7 / I1 / C1.0)
- 依存: なし (08は本PBIの後に実施。types.ts競合回避)
- 種別: refactor
- 規模: S
- プライバシー: 接触なし
- 振る舞い変更: なし (型のみ)

## ユーザーストーリー

保守担当者として、messaging の alias 型重複を1箇所に集約してほしい。なぜなら `WithoutProtocolVersion` / `OutgoingMessage` が3箇所で複製され、timeout/retry 変更時の編集点が分散しているから。

## 背景 (Read確認済み)

- `src/messaging/sendWithPolicy.ts:26-27`, `src/messaging/gatewayFactory.ts:26-27`, `src/messaging/messageTransport.ts:71-72`: 同名 alias の3重複製。
- `src/messaging/types.ts:345-382`: `sendServiceWorkerMessage` 系。transport への素通しに見えるが factory 導入で mirror 重複は解消済みのため層自体は維持 (earning keep)。
- `src/messaging/gatewayFactory.ts:68-76`: send 配線のみ。shallow に見えるが削除 test では trio 再出現のため維持が正しい。
- 方針: alias の正本を messageTransport に置き、他は re-export のみにする。gateway 層の削除はしない (Speculative)。

## BDD受け入れシナリオ

```gherkin
Scenario: alias の正本が1箇所になる
  Given 同名 alias が3箇所にある
  When PBIが実施される
  Then 正本は messageTransport のみが定義を持つ
  And 他2箇所は re-export のみである
```

```gherkin
Scenario: 公開 import 経路が壊れない
  Given 既存 caller が各所から import している
  When 集約される
  Then 型レベルで同一であり type-check が緑である
  And 実行時の振る舞いが変わらない
```

## 受け入れ基準

- [x] alias 正本が1箇所に集約され他は re-export のみである
- [x] `npm run type-check` 緑。既存テスト緑
- [x] gateway 層の削除は行わない (維持理由を PBI に記録)

## テスト戦略

- 単体: 型 pin のため新規テスト不要。既存 messaging テストで緑を確認。
- E2E追加なし。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-03-alias.md`
