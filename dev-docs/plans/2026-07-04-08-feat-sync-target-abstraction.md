# PBI: 追加出力先（Readwise / Notion）と SyncTarget 抽象化

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: C. 連携拡張
- type: feat / 優先度: 中

## ユーザーストーリー

Yasumaro 利用者として、Obsidian 以外（Readwise や Notion など）にも履歴を送れるようにしてほしい。なぜなら、利用しているツールは人によって異なり、記録先を選べると自分のワークフローに組み込めるから。

## ビジネス価値

出力先を増やせる基盤を作り、対象ユーザーと利用シーンを拡大する。測定: 追加出力先の有効化数。

## BDD受け入れシナリオ

```gherkin
Scenario: 抽象化された出力先に履歴が送られる
  Given SyncTarget として Notion が設定・認証済み
  When  ページが記録される
  Then  Notion 側に履歴エントリが作成される

Scenario: 出力先を複数有効化できる
  Given Obsidian と Readwise の両方が有効
  When  ページが記録される
  Then  両方の出力先へ送信される
  And   片方が失敗しても他方は成功する
```

## 受け入れ基準

- [ ] `SyncTarget` インターフェースを定義する
- [ ] 既存 Obsidian 同期を SyncTarget 実装として再構成する
- [ ] 少なくとも1つの新規出力先（Notion か Readwise）を実装する
- [ ] 複数出力先を独立して有効化・失敗分離できる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 新規出力先を有効化 → 記録 → 送信される

### 統合テスト
- `obsidianSyncService` の SyncTarget 化コントラクト
- 複数ターゲットの失敗分離

### 単体テスト
- SyncTarget インターフェース準拠
- ターゲットごとのペイロード整形

## 実装アプローチ

Outside-In / Red-Green-Refactor。まず既存 Obsidian 同期を SyncTarget として抽出（リファクタ）してから新規実装を足す。

## 見積もり

13pt（Epic寄り。着手前にシニアと設計相談を推奨）

## 技術的考慮事項

- 依存: feature-07（書き出し抽象化とセット設計が綺麗）
- 再利用: `src/background/obsidianSyncService.ts`（抽象化のベース）、`src/utils/urlUtils.ts`（SSRF/URL検証）
- 外部API認証情報は `src/utils/crypto.ts` で暗号化保存

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "SyncTarget\|syncService\|notion\|readwise" src/
grep -rn "class\|export" src/background/obsidianSyncService.ts
```

### 落とし穴

- 外部SaaSへの送信はプライバシー影響が大きい。既存の PrivacyPipeline / 同意フローを通した上で送る設計にする。
- レート制限・リトライを出力先ごとに持つ。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
