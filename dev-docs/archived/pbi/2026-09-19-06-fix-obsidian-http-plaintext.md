# PBI: 非localhost の http Obsidian 連携を警告・ブロックする

## ユーザーストーリー
拡張機能利用者として、履歴データが平文で送信されそうになったら警告してほしい、なぜなら閲覧履歴・AI要約の盗聴は取り返しがつかないから

## 優先度
- 順位: 06 / 13
- RICEスコア: 20（Reach=20 / Impact=2 / Confidence=80% / Effort=1.6）
- 根拠: プライバシー実害があり対象ユーザーは絞られるが明確。設定UI側の対応も含む縦スライス

## ビジネス価値
平文送信による履歴漏えいを防止する。localhost 利用者は影響を受けない

## BDD受け入れシナリオ

```gherkin
Scenario: 非localhost の http 設定は警告される
  Given Obsidian 連携先が LAN 内他ホストの http
  When 設定を保存しようとする
  Then 警告が表示される
  And localhost の http では警告が出ない

Scenario: 警告後にブロックまたは明示的承認ができる
  Given 警告が表示されている
  When ユーザーが承認する
  Then 設定が保存される
  And 承認しない場合は保存されない
```

## 受け入れ基準
- [x] localhost/127.0.0.1 以外の http でブロックされる（validateObsidianProtocol が throw）
- [x] localhost の http は従来通り利用できる（警告ログ付き）
- [x] 設定UIに https 推奨の明示がある（fieldValidation.ts の protocolWarning が既存）
- [x] 既存の https・localhost 設定が壊れない（13 tests green）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 設定画面での http/https/localhost の組み合わせテスト

### 統合テスト
- obsidianClient のプロトコル判定テスト

### 単体テスト
- ホスト判定ロジック（localhost/127.0.0.1/::1 等）の境界値

## 実装アプローチ
- **Outside-In**: 設定画面の警告シナリオから開始
- **Red-Green-Refactor**: 判定ロジックを純粋関数化する

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: ホスト判定は純粋関数に切り出す
- 非機能要件: 既存ユーザーの localhost 設定を壊さないことが最優先

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "http\|https" src/background/obsidianClient.ts | head -20
```

### 実装手順
1. ホスト判定の単体テストを書く
2. obsidianClient に警告・ブロック判定を追加する
3. 設定UIに明示を追加する

### 落とし穴
- IPv6 の ::1 やホスト名 localhost の表記揺れを考慮すること
- いきなり全面ブロックにせず警告→承認の段階を踏むこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
