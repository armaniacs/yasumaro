# PBI: trustChecker のレガシー設定 API デッドコードの削除

種別: fix

## ユーザーストーリー

信頼設定を保守する管理者として、信頼レベルの正本を一箇所に明確に定義したい。Trust DB と旧 settings の二重 source を前提とする誤った修正を避け、production 参照のないレガシー API を残さないために必要である。

## ビジネス価値

- trust 設定の source of truth を Trust DB に一本化し、誤った storage 経路で設定を変更する誤認を防ぐ。
- 到達不能な API と専用テストを削除し、production で使用される `trustChecker` の公開面を実態に合わせる。
- 旧 settings バックアップにレガシー値が残っていても、信頼設定の挙動へ影響しない状態を保つ。

## 優先度

- 順位: 05 / 30
- RICEスコア: 3.0（Reach=3 / Impact=0.5 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Feature: trust 設定の source of truth を Trust DB に一本化する

  Scenario: 生産参照のないレガシー API を削除する
    Given getSafetyMode、setSafetyMode、getTrancoTier の production 参照がない
    When trustChecker のレガシー API と専用テストを削除する
    Then 3 つの API が trustChecker の公開面に存在しない
    And 専用の旧 API テストが削除されている
    And checkDomain と alert 設定の active なテストが維持されている

  Scenario: 現在の UI が Trust DB を正本として利用する
    Given Trust DB に tranco tier の設定が保存されている
    When 現在の trust 設定経路が設定値を読み込む
    Then dbData.tranco.tier が読み取られる
    And 旧 settings の trust 値には依存しない

  Scenario: 旧 settings バックアップにレガシー値が残っている
    Given 旧 settings バックアップに SAFETY_MODE と TRANCO_TIER の値が残っている
    When 信頼設定を読み込む
    Then 旧値を読み書きする経路を使わない
    And Trust DB の trust 設定だけが有効になる
```

## 受け入れ基準

- [ ] `src/utils/trustChecker.ts` から `getSafetyMode()`、`setSafetyMode()`、`getTrancoTier()` を削除する。
- [ ] `src/utils/__tests__/trustChecker.test.ts:259-322` のレガシー API 専用テストを削除する。
- [ ] `checkDomain` と alert 設定に関する active なテストは削除しない。
- [ ] `StorageKeys.SAFETY_MODE` と `StorageKeys.TRANCO_TIER` を storage 型定義から削除する。
- [ ] `SAFETY_MODE` と `TRANCO_TIER` の既定値を storage defaults から削除する。
- [ ] production 呼び出しが 0 の `trancoUpdater` のレガシー mapping と methods を削除し、専用テストの参照も除去する。
- [ ] 旧 settings バックアップのレガシー値は読み飛ばし、互換用の読み書き経路を残さない。
- [ ] `src/dashboard/settings/trustSettings.ts` は変更せず、`dbData.tranco.tier` を正本とする現在の経路を維持する。
- [ ] `src/background/pipeline/steps/checkTrustDomainStep.ts`、`src/dashboard/settings/trustSettings.ts`、`src/popup/statusPanel.ts` の active な production import を維持する。
- [ ] 変更後に ESM import を追加する場合は `.js` 拡張子を使う。
- [ ] レガシー API 名と storage key 名が、削除対象として残った production コードに存在しないことを静的確認する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 旧 settings バックアップにレガシー値が残っていても、現在の trust 設定が Trust DB の `dbData.tranco.tier` を正本として表示・利用することを 1 本の回帰シナリオで確認する。
- 旧 API の削除後も、現在の alert 設定と `checkDomain` の利用に回帰がないことを確認する。

### 統合テスト

- Trust DB に `tranco.tier` を設定し、`trustSettings.ts` の経路が旧 settings を参照せず、その値を読み込むことを確認する。
- 旧 settings に `SAFETY_MODE` と `TRANCO_TIER` がある状態でも、Trust DB の trust 設定が変更されないことを確認する。
- 3 つの active な `trustChecker` production import を含む型チェックと関連テストを実行する。
- `trancoUpdater` のレガシー mapping と methods 削除後、残る active な経路に影響がないことを確認する。

### 単体テスト

- 削除したレガシー API の専用テストを廃止する。
- `checkDomain` と alert 設定の active な単体テストを維持し、回帰がないことを確認する。
- `trancoUpdater` のテストから、削除した mapping と methods への参照を除去する。
- 削除後の `trustChecker` が `getSafetyMode`、`setSafetyMode`、`getTrancoTier` を公開していないことを静的に確認する。
- `StorageKeys.SAFETY_MODE`、`StorageKeys.TRANCO_TIER` と対応する defaults が残っていないことを静的に確認する。

## 実装アプローチ

1. `trustChecker.ts` のレガシー API 3 つだけを削除し、active な `checkDomain` と alert 設定の挙動を変更しない。
2. レガシー API の専用テストだけを削除し、active なテストを同じ変更で整理する。
3. storage 型定義と defaults から `SAFETY_MODE` と `TRANCO_TIER` を同時に削除する。
4. production 参照が 0 の `trancoUpdater` mapping と methods、および対応するテスト参照を削除する。
5. 現在の UI が `dbData.tranco.tier` を読む経路に差分がないことを確認する。
6. E2E から統合、単体の順に Outside-In で回帰を確認し、型チェックと対象テストを通す。
7. クリーンアップ後、`pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` による namespace 再編へ進める。

## 見積もり

0.5 SP

## 技術的考慮事項

- **公開面の整合**: production 呼び出しが 0 でもレガシー API は module の public surface になるため、削除後に Trust DB の経路だけが公開 setting surface となる。
- **storage 契約**: key、Settings interface、defaults は同時に変更し、片方だけの残置を避ける。
- **旧バックアップ**: 旧 settings にレガシー値が残っていても読み飛ばし、読み込み互換処理や移行処理を追加しない。
- **active 経路の分離**: `trustSettings.ts` は Trust DB の正本であり、この PBI では変更しない。
- **依存関係**: `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` より先に `trustChecker.ts` をクリーンアップする。`pbi/2026-09-25-08-doc-trust-record-policy-correction.md` とは trust 仕様と用語を整合させる。
- **ESM**: import 構文を変更する場合は `.js` 拡張子必須とする。

## 実装者向け注記

### 現状コードの確認

調査済み事実は次のとおりである。

- `src/utils/trustChecker.ts:182-187` に `getSafetyMode()`、`:192-202` に `setSafetyMode()`、`:207-212` に `getTrancoTier()` が存在する。
- 3 つの production 呼び出しは 0 件で、7 件の参照はすべて `src/utils/__tests__/trustChecker.test.ts:266-321` のテストである。
- `entrypoints/` にレガシー API の参照は 0 件である。
- `trustChecker` の production import は 3 件で、`src/background/pipeline/steps/checkTrustDomainStep.ts`、`src/dashboard/settings/trustSettings.ts`、`src/popup/statusPanel.ts` にある。これらは alert 設定と `checkDomain` の active な用途である。
- 現在の UI は `src/dashboard/settings/trustSettings.ts:397-416` で Trust DB の `dbData.tranco.tier` を正本として読む。
- `StorageKeys.SAFETY_MODE` と `StorageKeys.TRANCO_TIER` は `src/utils/storage/types.ts:137-138,380-381` と `src/utils/storage/defaults.ts:107-108` に残っているが、active な呼び出し元はない。
- `src/utils/trustDb/__tests__/trancoUpdater.test.ts` にある未使用 mapping と methods に対応する production 呼び出しは 0 件である。
- レガシー経路の削除は未実施であり、本 PBI の対象である。

### 実装手順

1. 依存順序として、本 PBI の `trustChecker.ts` クリーンアップを namespace 再編より先に完了する。
2. レガシー API 3 つを `trustChecker.ts` から削除する。
3. `trustChecker.test.ts:259-322` だけを削除し、`checkDomain` と alert 設定のテストを保持する。
4. storage 型定義と defaults から 2 つの key を同時に削除する。
5. `trancoUpdater` の未使用 mapping と methods、およびテスト中の該当参照を削除する。
6. active な 3 つの production import と `trustSettings.ts` に不要な差分がないことを確認する。
7. E2E、統合、単体テストの順に回帰を確認し、型チェックと対象テストを完了する。

### 落とし穴

- production 参照が 0 でもレガシー API は module の public surface であり、意図せず残すと誤った実装の再導入を許す。
- `trustChecker.test.ts` の active な `checkDomain` と alert 設定テストまで一緒に削除すると、残存する機能を検証できなくなる。
- storage の型定義だけ、または defaults だけを削除すると、古い設定契約の一部が残る。
- 旧 settings バックアップの互換性を理由に読み込み経路を再導入すると、Trust DB と二重の source に戻る。
- `trustSettings.ts` を Trust DB 以外の storage へ接続し直す変更は本 PBI の範囲外である。
- namespace 再編を先に実施すると、`trustChecker.ts` の削除対象が移動・再格式化され、確認を妨げる。

## 決定事項

- レガシー API、専用テスト、storage 型定義、storage defaults を削除する。
- production 参照が 0 の `trancoUpdater` mapping と methods も削除し、Trust DB に依存しない旧 mapping を残さない。
- 旧 settings バックアップのレガシー値は読み飛ばし、読み書き用の互換経路や既定値は残さない。
- 現在の `trustSettings.ts` にある `dbData.tranco.tier` 経路は変更しない。
- 本 PBI を `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` の `trustChecker.ts` 再編より前に完了する。
- `pbi/2026-09-25-08-doc-trust-record-policy-correction.md` では、Trust DB が信頼設定の正本であることを整合させる。

## Definition of Done

- [ ] `getSafetyMode()`、`setSafetyMode()`、`getTrancoTier()` と専用テストが削除されている。
- [ ] `StorageKeys.SAFETY_MODE`、`StorageKeys.TRANCO_TIER` と対応する defaults が削除されている。
- [ ] 未使用の `trancoUpdater` mapping と methods、およびテスト参照が削除されている。
- [ ] `trustChecker` の active な `checkDomain` と alert 設定テストが維持され、回帰がない。
- [ ] 現在の UI が Trust DB の `dbData.tranco.tier` を正本として利用する経路に変更がない。
- [ ] 3 つの active な production import と ESM import 規約を維持している。
- [ ] 旧 settings バックアップのレガシー値を読み書きする経路が残っていない。
- [ ] BDD 受け入れシナリオを満たす統合・単体テストと型チェックが通る。
- [ ] `pbi/2026-09-25-08-doc-trust-record-policy-correction.md` と trust 設定の正本に関する記述が整合している。
- [ ] 本 PBI と無関係な変更が含まれていない。
