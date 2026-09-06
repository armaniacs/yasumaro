# PBI: テスト型債務返済 3/5 — utils + messaging + src/__tests__（570 errors / 86 ファイル）

## ユーザーストーリー

yasumaroの開発者として、`src/utils`（ドメインフィルタ・PII サニタイザ・trustDb・storage 等の共有ライブラリ）と `src/messaging` 配下のテストに型チェックの生のゲートが効いてほしい。なぜなら、utils は全モジュールから参照される共有基盤であり、型債務が最も広く伝播する場所だから（シリーズ共通の背景は `pbi/00-INDEX.md` 参照）。

## 分析: 本バッチのスコープ（実測 2026-09-07、インベントリ = testDir/type-check-baseline.json）

- スコープ: **`src/utils/**` + `src/messaging/**` + `src/__tests__/**` の baseline エントリ** — 542 + 14 + 14 = 570 errors / 86 files
- 上位ファイル: `contentExtractor/__tests__/index.test.ts`(86)・`piiSanitizer.test.ts`(39)・`storageUrls.test.ts`(38)・`trustDb.test.ts`(51)
- エラー内訳（ディレクトリ傾向）: null 安全性、リテラル不一致、暗黙 any
- 依存なし・他バッチと並行可

## ビジネス価値

- 共有ライブラリ（全モジュールの基盤）に型レベルの実害検知を導入する
- PII サニタイザ・domain filter などプライバシー系ロジックのテスト堅牢化

## BDD受け入れシナリオ

```gherkin
Scenario: utils + messaging 配下の型エラーが 0 になる
  Given src/utils / src/messaging / src/__tests__ 配下の baseline エントリが全て返済されている
  When npm run type-check:test:raw を実行する
  Then 出力に同配下の error が 0 件である
  And 全 vitest がグリーン（実行時挙動不変）
```

## 受け入れ基準

- [ ] `src/utils/**` + `src/messaging/**` + `src/__tests__/**` が baseline から消滅
- [ ] baseline.json から返済済みエントリを削除
- [ ] 型レベル修正のみでテストの実行時挙動を変えない（全 vitest グリーン維持・1 コミット = 1〜3 ファイル）
- [ ] 実装側の実バグ発見は別 PBI に切り出す（発見 0 件でもメモに記録）
- [ ] `npm run validate` が exit 0

## テスト戦略

### 単体テスト
- なし（既存テストの期待値を変えない）

### E2Eテスト
- なし

## 実装アプローチ

1. `type-check:test:raw` の出力を 3 配下でフィルタし、エラー数の多い順に返済
2. 返済パターンは 2026-09-07-08 と同一（シリーズ共通 — INDEX セクション参照）
3. `contentExtractor/index.test.ts`（86 件）は最大 — describe 単位で複数コミットに分割可

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-04（ベースラインゲート稼働中）が前提。08〜11 は互いに独立・並行可
- **テスタビリティ**: 1 ファイル返済のたび vitest run で挙動不変を確認
- **非機能要件**: 実行時挙動を変えないこと

## 実装者向け注記

### 現状コードの確認
```bash
npm run type-check:test:raw 2>&1 | grep -E "src/(utils|messaging)" | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10
```

### 落とし穴
- **noUncheckedIndexedAccess**: 配列アクセス（`rows[0]`）が `| undefined` — テスト意図に合わせ `!` か先頭ガード
- **`exactOptionalPropertyTypes`**: `prop: undefined` の代入が型エラーになる — 実テスト意図（undefined を渡したい）ならオブジェクトスプレッドで条件付き構築
- **PII サニタイザ系**: 期待値の文字列は絶対に変更しない（プライバシー保護の回帰テスト）

## Definition of Done

- [ ] `src/utils` + `src/messaging` + `src/__tests__` が baseline から消滅
- [ ] `npm run validate` exit 0
- [ ] コードレビュー完了
- [ ] 実装バグ発見の有無をメモに記録
