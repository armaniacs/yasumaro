# PBI 2026-11-08-07: report scope twin traversal の統合

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 7/9
- RICE: 3.2 (R4 / I1 / C0.8)
- 依存: なし
- 種別: refactor
- 規模: S
- プライバシー: 接触なし
- 振る舞い変更: なし (reject/absorb の意図差は維持)

## ユーザーストーリー

保守担当者として、report scope の二重走査を1箇所に寄せてほしい。なぜなら validator (reject) と normalizer (absorb) の policy 差が2 module に分散し、field 追加時の抜け漏れが起きるから。

## 背景 (Read確認済み)

- `src/messaging/validators.ts:784-825`: reject (非string→`:786`、非finite→`:795`、ids非整数→`:820`)。
- `src/messaging/responseCanonical.ts:185-228`: absorb (空白→null `:134-147`、ids不正除外 `:202-205`)。
- 表自体は単一 owner 化済み (`validators.ts:780-783`)。残りは走査統合だけ。吸収/拒否の意図差は仕様。
- `src/messaging/sqliteValidators.ts:10,62`: `validators.ts` から `isFiniteNumber` を import・再 export する seam 漏れあり。
- 方針: scope codec を responseCanonical 側に一本化し validator は同表参照の述語を呼ぶ adapter 化。reject/absorb 差は policy 引数で分岐、traversal は1箇所に残す。

## BDD受け入れシナリオ

```gherkin
Scenario: 走査が1箇所になる
  Given 同一 field 表を2箇所が走査している
  When PBIが実施される
  Then traversal は1箇所に残る
  And validator は述語呼出のみになる
```

```gherkin
Scenario: reject/absorb 差が保たれる
  Given 吸収と拒否の意図差が仕様である
  When 統合される
  Then 既存 pin が全て緑である
  And 差が policy 引数として対比可能である
```

## 受け入れ基準

- [x] traversal が1箇所に集約される
- [x] reject/absorb 差が policy として明示され既存 pin 緑である
- [x] sqliteValidators の seam 漏れが解消される (直 import か正本参照のいずれか)
- [x] 既存テスト緑

## テスト戦略

- 単体: `src/messaging/__tests__/` の既存 scope pin で緑確認。field 追加時の pin を1件追加。
- E2E追加なし。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-07-twin.md`
