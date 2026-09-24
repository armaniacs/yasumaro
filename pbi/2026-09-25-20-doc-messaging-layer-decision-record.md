# PBI: messaging から background への逆依存の許容判断を記録する

## ユーザーストーリー

保守者として、`src/messaging/types.ts` から `src/background/messageTypes.ts` への実行時 import を見たとき、循環も Chrome API の副作用もないため、この依存を現状維持する正式な判断であることを短時間で確認したい。現在の判断と理由が `dev-docs/ADR/` に記録されていることを求める。

## ビジネス価値

- 依存の向きだけを理由とする不要な再調査と修正提案を防ぐ。
- `ExtensionMessage`、`VALID_MESSAGE_TYPES`、`NO_PAYLOAD_TYPES` の単一の情報源を維持し、配列と型 union の二重定義を防ぐ。
- 現在の判断理由と再検討条件を、同じ場所から確認できるようにする。

## 優先度

- 順位: 20 / 30
- RICEスコア: 1.0（Reach=1 / Impact=0.25 / Confidence=100% / Effort=0.25 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: ADR一覧から現在の判断へ到達する
  Given この依存を許容する正式な判断記録が dev-docs/ADR にない
  When 将来の保守者が messaging から background への依存を調査する
  Then ADR一覧から正式な判断記録へ到達できる
  And 実害も循環もないため現状を維持する理由が記載されている

Scenario: 逆依存を未修正の構造違反として調査しない
  Given src/messaging/types.ts が background/messageTypes.js から実行時定数を import している
  When 保守者がこの依存を確認する
  Then ADRがこの依存を許容する判断として明記している
  And 循環がなく Chrome API の副作用も発生しないことが確認できる
  And CURRENT_PROTOCOL_VERSION の正本が messaging/protocol.ts であり messageTypes.ts は re-export 専用であることが確認できる

Scenario: 再検討が必要になった条件を判断できる
  Given 現在の依存に実際の循環や別の副作用がない
  When 実際の循環、実行時 import graph の増加、または新しい層で同じ逆依存が発生した
  Then ADRに記載した再検討トリガーが判断の起点を示す
```

## 受け入れ基準

- [ ] `dev-docs/ADR/2026-09-25-messaging-background-reverse-dependency.md` を、既存の日付付き kebab-case 命名と書式に合わせて作成する。
- [ ] ADRに「この依存を許容し、現状を維持する」という決定と理由を記載する。
- [ ] ADRに、以下を再検討トリガーとして記載する。
  - 実際の循環が発生した場合
  - 実行時 import graph が増えた場合
  - 新しい層を追加した際に同じ逆依存が再できた場合
- [ ] ADRに、循環が存在せず、`src/background/messageTypes.ts` が Chrome API の副作用を発生させない module であることを記載する。
- [ ] ADRに、`CURRENT_PROTOCOL_VERSION` の正本は `src/messaging/protocol.ts`、`src/background/messageTypes.ts` は re-export 専用であることを記載する。
- [ ] ADRは決定と理由のスナップショットとし、経緯ログ、移行履歴、issue 番号を記録しない。
- [ ] 実コード、型、import 経路、定数は変更しない。
- [ ] `ExtensionMessage`、`VALID_MESSAGE_TYPES`、`NO_PAYLOAD_TYPES` の二重定義を発生させない。
- [ ] 今後の中立化を行う場合も、content script や offscreen から provider strategy を持ち込まないという制約を明記する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- ADR一覧から作成した ADR を開き、「何を維持するか」「なぜ維持するか」「いつ再検討するか」を保守者が一続きに確認できることをレビューする。
- ADRだけを読んで、実害のない依存を修正対象と誤認しないことを確認する。

### 統合テスト

- ADRの記載と以下の現状が一致することを確認する。
  - `src/messaging/types.ts:156-157` の import 先
  - `src/background/messageTypes.ts:2-5` の Chrome API 副作用回避方針
  - `src/background/messageTypes.ts:23-27` の `messaging/protocol.js` のみへの import
  - production の完全一致 import 宣言13件、全 repository で22件、対象11ファイル
  - `CURRENT_PROTOCOL_VERSION` の正本と re-export 専用ファイルの役割
- 既存の整合性を確認する。
  - `src/messaging/__tests__/types.test.ts`
  - `src/__tests__/messaging-types-uniformity.test.ts`
  - `src/background/__tests__/message-types-consistency.test.ts`

### 単体テスト

- 実コードを変更しないため、新しい単体テストは作成しない。
- ADR内に `VALID_MESSAGE_TYPES` の配列と union について、正本の所在と二重定義禁止が明記されていることを文書レビューで確認する。
- `.js` 拡張子を必須とする ESM import 規約と、provider strategy を content script や offscreen へ持ち込まない制約が記載されていることを確認する。

## 実装アプローチ

1. 現行の依存関係と実害がない理由を、ADRのコンテキストへ記載する。
2. 「この逆依存を許容し、コードは現状維持する」という決定と結果を記載する。
3. 実際の循環、実行時 import graph の増加、新しい層での再発を再検討トリガーとして記載する。
4. 単一の情報源、ESM import 規約、中立化する場合の strategy 境界を記載する。
5. `dev-docs/ADR/README.md` の一覧へ ADR を追加する。
6. 実コードを変更せず、ADRと一覧の参照関係をレビューする。

## 見積もり

0.25 SP

## 技術的考慮事項

- `src/messaging/types.ts` は実行時の `VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES` を `src/background/messageTypes.js` から import する。
- `src/background/messageTypes.ts` は中立な `messaging/protocol.js` のみを import するため、循環はない。
- `src/background/messageTypes.ts` は Chrome API の副作用を発生させない module であり、型と純粋な定数を中心とする。
- production の完全一致 import 宣言は13件、全 repository では22件で、対象は次の11ファイルである。
  - `src/messaging/types.ts`
  - `src/messaging/dashboardGateway.ts`
  - `src/messaging/validators.ts`
  - `src/messaging/messageTransport.ts`
  - `src/popup/statusChecker.ts`
  - `src/popup/recordCurrentPage/previewFlow.ts`
  - `src/popup/recordCurrentPage/recordSession.ts`
  - `src/content/contentMessageSender.ts`
  - `src/dashboard/generalSettings/connectionTests.ts`
  - `src/dashboard/reviewSummaryHandler.ts`
  - `src/dashboard/settings/ublockImport/urlFetcher.ts`
- `CURRENT_PROTOCOL_VERSION` の正本は `src/messaging/protocol.ts` であり、`src/background/messageTypes.ts` は re-export 専用である。
- 依存関係として `pbi/2026-09-25-03-refactor-previewonly-flag-cleanup.md` の `RecordingData` 型所有者と、`pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` の `src/messaging/types.ts` の utils import path 変更があるが、この ADRで許可する依存の判定自体は変えない。
- 将来の中立化では、ESM import の `.js` 拡張子を必須とし、配列と union の二重定義を禁止する。
- 将来の中立化で content script や offscreen から provider strategy を持ち込まない。

## 実装者向け注記

### 現状コードの確認

- `src/messaging/types.ts:156-157` が `background/messageTypes.js` から `VALID_MESSAGE_TYPES` と `NO_PAYLOAD_TYPES` を import する。
- `src/background/messageTypes.ts:23-27` は中立な `messaging/protocol.js` のみを import する。
- `src/background/messageTypes.ts:2-5` に Chrome API の副作用を発生させない module であることを示すコメントがある。
- `src/background/messageTypes.ts` の production 完全一致 import 宣言は13件、全 repository では22件である。
- `dev-docs/ADR/` にこの依存を許容する正式な判断記録はない。

### 実装手順

1. `dev-docs/ADR/2026-09-25-messaging-background-reverse-dependency.md` を作成する。
2. 既存 ADRの命名、節構成、状態に合わせ、「採用済み」の判断として現状維持を記載する。
3. 依存の現状、循環がないこと、副作用がないこと、単一の情報源である理由を記載する。
4. 許容の理由と3項目の再検討トリガーを記載する。
5. コード変更を行わない方針と、将来の中立化時の制約を記載する。
6. `dev-docs/ADR/README.md` の一覧へ追加する。
7. ADRと一覧だけをレビューし、実コードを変更しない。

### 落とし穴

- ADR 作成だけで実際のコード変更がないため、レビュー時に「本当に修正しないのか」と聞かれる可能性がある。循環も実害もないため、この依存を現状維持することを明確に回答する。
- 「messaging が background に依存する」ことだけを理由に構造違反や修正対象として記録しない。
- ADRに「この依存は許可される」とだけ書き、理由と再検討トリガーを省かない。
- 現在の依存許容を、messaging から background へのすべての依存に対する一般的な許可と解釈させない。
- 経緯ログ、移行履歴、issue 番号を ADRへ追加しない。
- 中立化を実装する段階で provider strategy を content script や offscreen へ持ち込まない。
- `VALID_MESSAGE_TYPES` の配列と `ExtensionMessage` の union を別々に再定義しない。

## 決定事項

### 5 Whys

1. なぜ中立な messaging が background を import するのか。messageTypes は、中立化되기前の background に作成されたからである。
2. なぜ循環がないのに実害もないのか。対象 module に Chrome API の副作用がなく、型と純粋な定数を中心にしているからである。
3. なぜ単一の情報源を維持するのか。配列と union の二重定義を防ぐためである。
4. なぜ構造上の負債を消さないのか。実害がないため、現状維持が妥当だからである。
5. 何を記録として残すのか。判断理由と再検討条件を正式な ADR として残し、既存の記録だけに依存しないからである。

### 最終決定

- `src/messaging/types.ts` から `src/background/messageTypes.ts` への現在の実行時 import を許容し、コードは現状維持する。
- 実害がないことを理由に、階層名だけを根拠とした再調査や修正を行わない。
- 実際の循環、実行時 import graph の増加、新しい層で同じ逆依存が再できた場合に再検討する。
- 正式な判断と理由は `dev-docs/ADR/` にスナップショットとして記録する。

## Definition of Done

- [ ] 指定の命名と既存書式に従う ADR を作成した。
- [ ] ADRに依存を許容する決定、理由、結果、影響範囲を記載した。
- [ ] ADRに3項目の再検討トリガーを記載した。
- [ ] ADRに単一の情報源、ESM import 規約、strategy 境界を記載した。
- [ ] ADRの一覧を更新した。
- [ ] 実コード、型、import 経路、定数を変更していない。
- [ ] 配列と union の二重定義を発生させていない。
- [ ] 経緯ログ、移行履歴、issue 番号を ADRへ追加していない。
- [ ] 既存テスト3件と文書参照の一致性を確認した。
- [ ] ドキュメントレビューで、依存を実害のある未修正課題と誤認しないことを確認した。
