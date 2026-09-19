# PBI: getAbsentVersionCount の JSDoc を test seam として明記する

## ユーザーストーリー
開発者として、カウンタ getter の用途がコードから分かってほしい、なぜなら本番診断は logInfo に移行済みで、古い JSDoc のままでは未来の開発者が誤った消費経路を設計するから

## 優先度
- 順位: 23 / 全候補3件中3位
- RICEスコア: 20（Reach=5 / Impact=0.5 / Confidence=80% / Effort=0.1）
- 根拠: コメント1行の是正。振る舞い変更なし

## ビジネス価値
診断の正規経路（logInfo）とテストシーム（getter）の役割が明確になる

## BDD受け入れシナリオ

```gherkin
Scenario: JSDoc が用途を正しく説明する
 Given getAbsentVersionCount の定義
 When コードを読む
 Then テスト用シームであることと、本番診断は logInfo であることが分かる
```

## 受け入れ基準
- [x] getAbsentVersionCount の JSDoc が test seam であることを明記（本番診断は logInfo と注記）
- [x] 振る舞い変更なし（envelopePolicy 15 tests green、type-check green）
- 注: 編集過程で `let absentVersionCounter = 0;` 宣言が誤って失われ type error となったが、即座に検出（テスト失敗）・復元済み。宣言には session-scoped 注記を追加

## テスト戦略（t_wadaスタイル）

### E2E/統合/単体
- 不要（コメントのみ。envelopePolicy 既存テストで回帰なしを確認）

## 実装アプローチ
- コメント更新のみ

## 見積もり
0.5ストーリーポイント未満（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 05・18 の前提
- テスタビリティ: 影響なし

## 実装者向け注記

### 現状コードの確認
```bash
grep -n -B 6 "export function getAbsentVersionCount" src/background/handlers/envelopePolicy.ts
```

### 実装手順
1. JSDoc を更新する

### 落とし穴
- getter を削除しないこと。envelopePolicy.test.ts が使用している

## Definition of Done
- [x] 振る舞い変更なしで既存テスト green
- [x] コードレビュー完了
