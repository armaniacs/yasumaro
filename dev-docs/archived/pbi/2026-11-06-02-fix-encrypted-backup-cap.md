# PBI: 暗号化バックアップのenvelope上限とファイル上限の不整合を解消する

## ユーザーストーリー
履歴の多いユーザとして、暗号化バックアップで復元したい、なぜなら現状はファイル上限50MBまで選べるのに復号前のenvelope上限10MB (`MAX_ENVELOPE_BASE64_LENGTH`) で `Envelope data exceeds maximum length` となり、正規の移行ルートが存在しないから (実測46MBバックアップが復号不可)

## ビジネス価値
- 履歴の多いユーザがパスワードベースの正規ルートでプロファイル間移行できるようになる
- 「選べるが開けない」UIの矛盾がなくなる
- 測定方法: 12MB級 `.db` を含むバックアップの作成→復元が往復成功すること

## BDD受け入れシナリオ

```gherkin
Scenario: 大容量バックアップが往復する
  Given 12MB級の履歴DBを持つプロファイルがある
  When 暗号化バックアップを作成し別プロファイルで復元する
  Then 設定と履歴が復元される

Scenario: 上限超過は選ぶ前に分かる
  Given 復元不能なほど巨大なバックアップファイルがある
  When ファイルを選択する
  Then 復号処理に入る前に上限超過として案内される

Scenario: 改ざん検知の維持
  Given 正規のバックアップファイルがある
  When ciphertext を1文字改変して復元する
  Then 復元が拒否される
```

## 受け入れ基準
- [x] 12MB級DBを含むバックアップが作成→復元できる
- [x] 上限超過時のエラーメッセージが原因 (サイズ超過) を特定できる
- [x] 改ざんファイルの拒否が維持される (VULN-036 の趣旨を損なわない)
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 大容量DBでのバックアップ作成→別プロファイル復元のシナリオテスト

### 統合テスト
- 上限境界値での作成可否と復元可否
- 改ざん envelope の拒否

### 単体テスト
- `validateEnvelope` の境界値 (上限ちょうど/超過)
- 上限超過時のエラー文言

## 見積もり
M (要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし (本PBI単独で完結)
- テスタビリティ: 100MB級の実割り当てを単体テストで避け、境界値は小さな合成envelopeで検証する
- 非機能要件: 上限はDoS増幅耐性 (VULN-036) のためのものなので、単純な引き上げではなく分割・段階復号などの設計で上限の趣旨を保つこと

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
# 機能に関連するキーワードでコードを探す
grep -rn "MAX_ENVELOPE_BASE64_LENGTH\|MAX_BACKUP_FILE_BYTES" src/ --include="*.ts" | grep -v __tests__
grep -rn "Envelope .* exceeds maximum length" src/ --include="*.ts" | grep -v __tests__
```

### 実装手順
1. Outside-In: まず大容量往復のE2E/統合テスト (失敗を確認) から書く
2. 上限設計を決める (バックアップ専用の上限分離 / 複数envelopeへの分割 / 段階復号など)
3. `envelope.ts` と `encryptedBackupPanel.ts` / `encryptedBackupService.ts` の上限チェックを整合させる
4. Red-Green-Refactor で各レイヤーを実装する

### 落とし穴
- 上限を上げるだけだと増幅攻撃の素になる。復号前チェックの順序 (cheap auth first) を崩さないこと
- `MAX_ENVELOPE_CIPHERTEXT_LENGTH` (64MiB) と `MAX_ENVELOPE_BASE64_LENGTH` (10MiB) は別レイヤーの定数なので混同しないこと (`limits.ts` の注記参照)
- 実測値の根拠: 2026-11-06 の移行事例で `.db` 11.7MB に対しバックアップ46MBが復号不可だった

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (E2E/統合/単体すべて)
- [x] コードレビュー完了
- [x] リファクタリング完了 (グリーン後)
- [x] ドキュメント更新済み
