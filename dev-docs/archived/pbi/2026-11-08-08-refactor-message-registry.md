# PBI 2026-11-08-08: message契約 loader複製の解消

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 8/9
- RICE: 2.4 (R3 / I1 / C0.8)
- 依存: 03の後 (types.ts競合回避)
- 種別: refactor
- 規模: S
- プライバシー: 接触なし
- 振る舞い変更: なし

## ユーザーストーリー

保守担当者として、protocol version の loader 複製を共有定数へ移してほしい。なぜなら bump 時に3点 drift (union/配列/loader) が起きるから。

## 背景 (Read確認済み)

- `src/background/messageTypes.ts:327-358`: type union。`src/messaging/messageTypeRegistry.ts:19-62`: runtime 定数。現状は re-export + parity test で抑止済みだが手動同期依存。
- `src/messaging/types.ts:216,305-340`: `ServiceWorkerRequest=ExtensionMessage` で回避済み。
- `src/messaging/envelopeShape.ts:29-74`, `src/messaging/protocol.ts:11-14`: NOTE 通り `CURRENT_PROTOCOL_VERSION=1` が `src/content/loader.ts` に hardcode 複製。
- 方針: registry の1行変更で完結する方向へ深掘り (subtype 表からの導出型・compile assert 強化)。loader 複製は共有定数へ移行。全面 codegen はしない (Speculative)。

## BDD受け入れシナリオ

```gherkin
Scenario: loader が共有定数を参照する
  Given CURRENT_PROTOCOL_VERSION が loader に複製されている
  When PBIが実施される
  Then loader は共有定数を参照する
  And bump 時の編集点が registry 側に集約される
```

```gherkin
Scenario: 契約 drift が検出される
  Given union/配列/loader の3点がある
  When 新種別が追加される
  Then compile assert か parity test が drift を検出する
```

## 受け入れ基準

- [x] loader の hardcode が共有定数参照になる
- [x] compile assert か parity test が3点 drift を検出する
- [x] 既存テスト緑

## テスト戦略

- 単体: messaging parity テストで緑確認。新種別追加時の検出 pin を1件追加。
- E2E追加なし。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-08-registry.md`
