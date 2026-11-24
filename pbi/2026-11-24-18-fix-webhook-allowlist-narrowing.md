# PBI: webhook 許可リストを webhook 専用ホストに狭める

## ユーザーストーリー
webhook を使う利用者として、送信先の許可リストが webhook 用の宛先だけに絞られていてほしい、なぜなら現状は AI プロバイダや `api.github.com` といった第三者のエンドポイントも送信先にでき、監査 run-3 で送信路として指摘されたから(owner が狭める方を裁定した)。

## 優先度
- 順位: 06/12 の監査 run-3 の needs_validation NV-1 に対応(owner 裁定: 狭める)
- RICE: 要チームでの見積もり
- 根拠と依存: 2026-11-24-15(平文保存の暗号化)と同一領域だが、変更箇所は別(判定表と pin)。後続は 2026-11-24-08(実機スモーク)

## ビジネス価値
- 第三者エンドポイントへの送信路がなくなる
- 測定方法: AI プロバイダ宛ての保存が拒否され、https loopback と Gist の扱いが仕様どおりであることがテストで緑であること

## BDD受け入れシナリオ

```gherkin
Scenario: AI プロバイダ宛ての webhook 保存は拒否される
  Given 利用者が webhook URL に `https://api.openai.com/v1/xxx` を入れる
  When  保存する
  Then  保存は拒否され、理由が表示される
  And   送信も行われない

Scenario: https loopback と Gist の扱いは仕様どおり
  Given 利用者が `https://127.0.0.1:27124/hook` または Gist 用の宛先を入れる
  When  保存する
  Then  仕様どおり許可または拒否される(狭め方針の定義に従う)
```

## 受け入れ基準
- [ ] 許可リストから第三者エンドポイントが外れ、webhook 専用ホストだけになっている(範囲の定義は実装時に ADR または本 PBI に明記)
- [ ] 意図的に固定する pin テスト(`webhookExportDestinations.test.ts`)と manifest の pin が新しいリストに追従している
- [ ] E2E(`webhook-egress.spec.ts`)が新しいリストで緑のまま
- [ ] 既存の保存済み宛先の扱い(祖父条項・移行・無効化の方針)が明記され、無音の無効化がない
- [ ] 脅威モデルの残余リスク節が新しいリストに追従している

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- `webhook-egress.spec.ts` を新しいリストで実行し、緑を確認する

### 統合テスト
- 保存時 pre-flight と送信ゲートの一致(全 URL 表)が新しいリストで緑

### 単体テスト
- 狭めた後の許可・拒否の表駆動テスト
- 発火デモ(AI プロバイダ宛てが現行で許可されること)を先に書き、赤を確認してから直す

## 実装アプローチ
- **Outside-In**: 拒否の発火デモから書き、赤を確認してから実装
- **Red-Green-Refactor**: TDD サイクルで進める

## 見積もり
3 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: 2026-11-24-15 と同一領域。先に取り込まれた方に合わせる
- テスタビリティ: `judgeWebhookDestination` の純関数性で表駆動できる
- 非機能要件: 保存済み宛先の無効化は利用者への通知か移行無しでは行わない
- ロールバック手段: リストの差し戻しで現行リストに戻せる

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること。

```bash
git -C /Users/yaar/Playground/yasumaro grep -n "WEBHOOK_EXPORT_DESTINATION_PATTERNS" src/background/webhookExport/webhookExportDestinations.ts
git -C /Users/yaar/Playground/yasumaro grep -n "api.github.com\|openai" src/background/webhookExport/__tests__/webhookExportDestinations.test.ts | head -10
```

確認結果(run-3 時点):
- 31 件の固定コピー(https loopback 8・AI 14・Gist 1・http 8)。pin が意図的に固定している

### 実装手順
1. 発火デモ(AI プロバイダ宛ての許可)を先に書く
2. リストを狭め、pin と manifest の pin を追従させる
3. E2E と validate を回す

### 落とし穴
- 既存の保存済み宛先を無音で無効化しないこと(祖父条項の方針と整合させる)
- 15(暗号化)の差分と競合したら、先に取り込まれた方に合わせること
- 脅威モデルの更新を忘れないこと

## Definition of DoD
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] CHANGELOG の `[Unreleased]` に利用者向けの変更として記載

## 引き継ぎ
状態: 未着手。run-3 の NV-1 に対応する修正 PBI(owner 裁定: 狭める)。
