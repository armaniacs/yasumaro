# PBI: package.json の uuid override を緩やかなSemVerレンジに変更

## ユーザーストーリー
開発チームとして、`uuid` パッケージの override 指定を適切なSemVerレンジにしたい、なぜなら現状の `">=11.1.1"` は上限のない無制限指定であり、将来のメジャーアップデートで破壊的変更が意図せず取り込まれるリスクがあるから

## ビジネス価値
- 依存パッケージの予期しないメジャーバージョンアップによる破壊的変更を防ぐ
- サプライチェーンの安定性向上

## 実装者向け注記（フェーズ0の既実装確認結果）

grep で確認済み:
- `package.json:85` — `"uuid": ">=11.1.1"`（`overrides` セクション内）
- レビュー指摘L10とL16は同一指摘の重複記載（親レポート `findings-detail.md` では両方とも「uuid override が緩すぎる」で対処案も同一の `"^11.1.1"`）。本PBIで一括対応する

```bash
# 実装前の再確認コマンド
grep -n "\"uuid\"" package.json
```

## BDD受け入れシナリオ

```gherkin
Scenario: uuid overrideがメジャーバージョン固定のレンジになる
  Given package.jsonのoverridesセクションにuuid: ">=11.1.1"が存在する
  When "^11.1.1"に変更する
  Then npm installでuuidパッケージが11.x系のみインストールされる
  And 既存のuuid依存箇所（crypto.randomUUID代替や関連ユーティリティ）が変更前と同じバージョン系統で動作する
```

## 受け入れ基準
- [ ] `package.json:85` の `"uuid": ">=11.1.1"` を `"uuid": "^11.1.1"` に変更
- [ ] `npm install` 後に `package-lock.json` が更新される
- [ ] `npm run build` / `npm test` が成功

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- 不要（依存バージョン制約の変更のみ、ランタイム挙動は不変）

### 単体テスト
- 不要

## 実装アプローチ
- `package.json` の1行変更 → `npm install` → `package-lock.json` の再生成 → ビルド/テスト確認、というシンプルな手順

## 見積もり
1pt（15分程度）

## 技術的考慮事項
- 依存関係: `npm install` の実行が必要
- テスタビリティ: `npm ls uuid` で実際にインストールされたバージョンを確認可能
- 非機能要件: サプライチェーンセキュリティ

## 落とし穴
- `overrides` の変更は `package-lock.json` の再生成を伴うため、他の依存関係のバージョンが意図せず変わらないか `git diff package-lock.json` で確認すること

## Definition of Done
- [ ] `package.json` の変更が適用されている
- [ ] `package-lock.json` が更新されている
- [ ] `npm run build` / `npm test` が成功
- [ ] コードレビュー完了
