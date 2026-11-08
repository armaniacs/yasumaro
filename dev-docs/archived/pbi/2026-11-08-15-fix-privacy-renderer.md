# PBI privacyレンダラーの構文対応と表示崩れ防止

## ユーザーストーリー
利用者として、プライバシーポリシー表示が見出しやリンクの構造通りに表示されてほしい、なぜなら構造崩れやリンク切れは内容の誤読につながるから。

## 優先度
- 順位: 15/17
- RICE: 24 (Reach=30 / Impact=0.5 / Confidence=80% / Effort=0.5人日)
- 根拠: 表示品質の小規模修正。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常のPRIVACY.md表示は従来通り
  Given 公開中のPRIVACY.mdがある
  When 利用者がプライバシーポリシー表示を開く
  Then 見出しと本文とリンクが従来通りに表示される
```

```gherkin
Scenario: h6見出しが構造表示される
  Given h6相当の見出しを含むPRIVACY.mdがある
  When 利用者がプライバシーポリシー表示を開く
  Then h6見出しが見出し構造として表示され段落化されない
```

```gherkin
Scenario: 重複見出しのアンカーが一意になる
  Given 同文の見出しが複数あるPRIVACY.mdがある
  When 利用者がプライバシーポリシー表示を開く
  Then 同文見出しのidが重複せず各アンカーが一意になる
```

```gherkin
Scenario: 括弧含みURLのリンクが切れない
  Given 括弧を含むURLのリンクがあるPRIVACY.mdがある
  When 利用者がプライバシーポリシー表示を開く
  Then 該当リンクが途中で切断されず正しい遷移先になる
```

## 受け入れ基準
- [x] 指摘(1) src/privacy/privacy.ts :37 の対処としてh6まで見出しとして表示される
- [x] 指摘(2) src/privacy/privacy.ts :42 の対処として同文見出しのidに重複がない
- [x] 指摘(3) src/privacy/privacy.ts :145 の対処として括弧含みURLが切断されない
- [x] 指摘(4) src/privacy/privacy.ts :162-164 の対処として太字内バッククォートの二重解釈がない
- [x] 指摘(5) src/privacy/privacy.ts :183 の対処として1MB上限がlimits系と共有される
- [x] 既存のPRIVACY.md表示に回帰がない
- [x] 回帰テストが追加されている

## テスト戦略
- 単体テスト中心で構文表を用意する
- 見出し段階(h1からh6)、重複見出し、括弧含みURL、太字とコード記法の組合せ、上限値の境界を表形式で網羅する
- Outside-Inの方針でBDDシナリオから単体テストへ落とし込む

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化されパスする
- [x] コードレビューが完了している

## 出典
- adversarial-code-review 2026-11-08
