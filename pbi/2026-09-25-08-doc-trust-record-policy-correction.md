# PBI: trust 判定の記録可否仕様と陳腐化記述の是正

種別: doc

## ユーザーストーリー

trust 判定を実装・レビューする開発者として、`LOCKED` のみが自動記録をブロックし、`SENSITIVE` と `UNVERIFIED` でも記録される現行仕様を1箇所で確認したい、なぜなら信頼レベルと記録可否、警告、信頼マークを混同すると誤った実装やレビュー指導につながるから。

## ビジネス価値

- trust 判定と録画可否の契約を明確にし、リスト外ドメインを未信頼として誤って記録拒否する誤解を防ぐ。
- 警告の有無と信頼マークの見た目と、録画可否が別々の契約であることを理解できる状態にする。
- 実装から生成されない入力値をテストで固定している状態を解消し、テストが現行仕様を表すようにする。

## 優先度

順位: 08 / 30
RICEスコア: 2.0（Reach=2 / Impact=0.25 / Confidence=100% / Effort=0.25 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: LOCKED だけ、通常記録をブロックする
  Given 対象ドメインの trust level が LOCKED である
  And force 録画が有効ではない
  When 録画パイプラインが trust 判定を行う
  Then canProceed は false になる
  And 通常記録がブロックされる

Scenario: Tranco リスト外のドメインを記録する
  Given 対象ドメインが Tranco リストに含まれない
  When trust level を判定する
  Then trust level は UNVERIFIED になる
  And canProceed は true になるため記録処理が続く
  And 既定では警告を表示しない
  And 信頼マークは灰色になる

Scenario: SENSITIVE でも記録する
  Given 対象ドメインの trust level が SENSITIVE である
  When trust 判定を行う
  Then canProceed は true になる
  And 記録処理が続く
```

## 受け入れ基準

- [ ] `docs/TRUST_DOMAIN_GUIDE.md` に、`LOCKED` のみが `canProceed=false` になり、`SENSITIVE` と `UNVERIFIED` では記録される仕様が明記されている。
- [ ] 警告と信頼マークは録画可否とは別の契約として明記し、これらを記録可否を示す識別子として説明していない。
- [ ] `dev-docs/blogs/blog-5_0/03-trust-database.md:124-144` から、Tranco リストへ追加すること自体を一般の記録許可条件とする誤った記述を解消している。
- [ ] blog の trust 判定説明は、`LOCKED` のみが記録ブロック条件となる現行仕様と一致しているか、`docs/TRUST_DOMAIN_GUIDE.md` への参照で現行仕様を確認できる。
- [ ] `src/background/pipeline/steps/__tests__/checkTrustDomainStep.test.ts:5-9,101-180` から、実運用で生成されない `UNVERIFIED / SENSITIVE + canProceed=false` fixture を削除している。
- [ ] fixture の説明とテスト名は、`LOCKED` のみが記録ブロック条件であることを表している。
- [ ] `src/utils/trustDb/__tests__/TrustLookup.test.ts:159-194` の全 trust level の `canProceed` matrix は、`LOCKED` だけが `false`、`TRUSTED / SENSITIVE / UNVERIFIED` が `true` を表す。
- [ ] `src/background/pipeline/steps/checkTrustDomainStep.ts` の production 挙動と、ホスト許可の明示 deny、force 録画の契約を変更していない。
- [ ] `PRIVACY.md` と `docs/PRIVACY.md` は変更していない。
- [ ] `UNVERIFIED` の警告を既定 ON にする仕様や mark 名変更など、新しい警告・信頼表示の仕様を追加していない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 自動ブロック条件と記録可否の production 挙動は変更しないため、新しい E2E テストは追加しない。
- blog と guide を横断して確認し、`LOCKED` 以外の記録可否、警告、信頼マークの説明に矛盾がないことを確認する。

### 統合テスト

- `src/background/pipeline/steps/__tests__/checkTrustDomainStep.test.ts` で、`UNVERIFIED` と `SENSITIVE` は `canProceed=true` の入力で記録処理へ進むことを確認する。
- 同じテストで、`LOCKED` は force 無効時に記録をブロックすることを確認する。
- ホスト許可の明示 deny と force 録画の既存契約に影響がないことを確認する。

### 単体テスト

- `src/utils/trustDb/__tests__/TrustLookup.test.ts:159-194` で、4つの trust level に対する `canProceed` matrix を検証する。
- 4つの trust level と `canProceed` の対応が、schema、`TrustLookup`、guide、blog、pipeline step の説明で一致することを確認する。

## 実装アプローチ

1. `pbi/2026-09-25-05-fix-trustchecker-legacy-dead-code.md` と同じ trust 仕様を扱うため、その PBI との実装順序と用語を揃える。
2. `docs/TRUST_DOMAIN_GUIDE.md` を trust 判定の記録可否を確認する正本として整理する。
3. blog の trust 判定説明を、現行仕様へ書き換えるか guide 参照へ差し替えるかを決め、誤った一般化を解消する。
4. `checkTrustDomainStep.test.ts` の入力 fixture と説明を、実運用で生成される `canProceed` の組み合わせへそろえる。
5. `TrustLookup.test.ts` の matrix と、guide、blog、pipeline step の契約を照合する。
6. production コード、プライバシー文書、ホスト許可の明示 deny、force 録画の契約を変更しないことを確認する。

## 見積もり

- 0.25 SP
- 難易度: 低

## 技術的考慮事項

- trust level は `TRUSTED / SENSITIVE / UNVERIFIED / LOCKED` の4型であり、`src/utils/trustDb/trustDbSchema.ts:19-24` が定義元である。
- `TrustCheckResult` は `{ canProceed, showAlert, reason?, trustResult }` であり、`src/utils/trustChecker.ts:11-17` に定義されている。
- `canProceed=false` となる trust level は `LOCKED` だけで、`SENSITIVE` と `UNVERIFIED` は `canProceed=true` となる。
- `src/background/pipeline/steps/checkTrustDomainStep.ts:28-45` は、`canProceed=false` の場合だけ force 無効時に記録をブロックする。
- Tranco リスト外は `UNVERIFIED` となり、記録可能である。既定では警告を出さず、信頼マークは灰色になる。
- 警告と信頼マークは記録可否と独立した表示契約であり、この PBI で新しい表示仕様を定義しない。
- ホスト許可の明示 deny と force 録画の既存契約は変更しない。
- `PRIVACY.md` と `docs/PRIVACY.md` はバイト一致ゲートがあり、どちらにも変更を加えない。
- 依存関係は `pbi/2026-09-25-05-fix-trustchecker-legacy-dead-code.md` であり、同じ trust 仕様の変更順を揃える。

## 実装者向け注記

### 現状コードの確認

- `src/utils/trustDb/trustDbSchema.ts:19-24` は `TRUSTED / SENSITIVE / UNVERIFIED / LOCKED` を定義する。
- `src/utils/trustChecker.ts:11-17` の `TrustCheckResult` は `canProceed`、`showAlert`、任意の `reason`、`trustResult` を持つ。
- `src/utils/trustDb/TrustLookup.ts:109-129` では、`canProceed=false` は `LOCKED` だけである。
- `src/background/pipeline/steps/checkTrustDomainStep.ts:28-45` は、force が無効かつ `canProceed=false` のときだけ記録をブロックする。
- `src/utils/trustDb/__tests__/TrustLookup.test.ts:159-194` は全 trust level の `canProceed` matrix を固定する。
- `docs/TRUST_DOMAIN_GUIDE.md:15-29,116-123,248-262,349-356` は、`LOCKED` 以外では自動ブロックせず、`SENSITIVE / UNVERIFIED` でも記録されることを明記する。
- `src/background/pipeline/steps/__tests__/checkTrustDomainStep.test.ts:5-9,101-180` には、実運用と一致しない `UNVERIFIED / SENSITIVE + canProceed=false` fixture がある。

### 実装手順

1. guide にある4 trust level、記録可否、警告、信頼マークの説明を一つの表に整理する。
2. blog の trust 判定に関する段落を、現行仕様へ書き換えるか guide 参照へ差し替えるか裁定する。
3. `checkTrustDomainStep.test.ts` の不可能な fixture を、`SENSITIVE / UNVERIFIED + canProceed=true` へそろえる。
4. テスト名・説明にある「Untrusted は block」という一般化を、`LOCKED` のみが記録ブロック条件である記述へそろえる。
5. `TrustLookup.test.ts` の matrix、schema、pipeline step、guide、blog の記述を照合する。
6. 関連する Jest テストと静的検証を実行し、production 挙動と対象外文書が変わっていないことを確認する。

### 落とし穴

- Tranco リスト外を「記録されない」状態として扱うと、`UNVERIFIED + canProceed=true` の現行仕様と矛盾する。
- `UNVERIFIED / SENSITIVE + canProceed=false` を fixture として使うと、production から生成されない値に対する契約が固定される。
- 警告の有無、信頼マークの色、記録可否を同じ判定として説明すると、それぞれ独立した契約が失われる。
- blog の trust 判定説明を guide へ委ねるか書き換えるかを決めずに blog を削除すると、現行仕様への導線が失われる。
- force 録画やホスト許可の明示 deny を trust level の表示仕様と同一視すると、既存契約を変更してしまう。
- `PRIVACY.md` を同期目的でも編集すると、バイト一致ゲートを壊す。

## 決定事項

- 本 PBI の範囲は、現行仕様に即した trust 判定の明文化と、guide と異なる説明・入力値の是正に限定する。
- `UNVERIFIED` の警告を既定 ON にする仕様や mark 名変更は本 PBI に含めず、必要に応じて別の仕様判断とする。
- blog の trust 判定説明は、現行仕様を直接記載する方式と `docs/TRUST_DOMAIN_GUIDE.md` への参照へ差し替える方式のどちらかを裁定する。
- いずれの方式でも、Tranco リストへの追加自体を一般の記録許可条件とする記述は残さない。
- `docs/TRUST_DOMAIN_GUIDE.md` を、trust 判定の記録可否を確認する1箇所の正本とする。

## Definition of Done

- [ ] `docs/TRUST_DOMAIN_GUIDE.md` に、4 trust level と `LOCKED` のみの記録ブロック条件が明記されている。
- [ ] guide に、`SENSITIVE / UNVERIFIED` でも記録されること、Tranco リスト外では既定の警告なし・灰色マークとなること、警告と信頼マークが記録可否と別であることが明記されている。
- [ ] `dev-docs/blogs/blog-5_0/03-trust-database.md:124-144` に、Tranco リストへの追加自体を一般の記録許可条件とする記述が残っていない。
- [ ] blog の扱い方針を裁定し、guide と矛盾する trust 判定の説明を解消している。
- [ ] `checkTrustDomainStep.test.ts` から、実運用で生成されない `UNVERIFIED / SENSITIVE + canProceed=false` fixture を削除し、関連する説明とテスト名を現行仕様にそろえている。
- [ ] `TrustLookup.test.ts` の全 trust level matrix と、関連する pipeline step のテストがパスしている。
- [ ] production の trust 判定、ホスト許可の明示 deny、force 録画の契約を変更していない。
- [ ] `PRIVACY.md` と `docs/PRIVACY.md` は変更していない。
- [ ] ドキュメントは現行仕様のスナップショットのみを記載している。
