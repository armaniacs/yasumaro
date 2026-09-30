# PBI: TypeScript 7 への移行（typescript-eslint 対応待ち）

**状態: 着手トリガー待ち。上流の対応リリースまで実装しない。**

## ユーザーストーリー

保守者として、TypeScript 7.0.2 への移行手順を先行整備し、上流対応のリリースで即座に移行したい。なぜなら typescript-eslint が TypeScript 7 未対応の間は `npm install` 自体が失敗するため、トリガー発火時に迷いなく移行できる状態にしておきたいから。

## 優先度

- 順位: 3 / 3（2026-09-26 依存更新ラウンド。採点の全体像は [2026-09-26-00-backlog-dependency-updates.md](2026-09-26-00-backlog-dependency-updates.md)）
- RICEスコア: 0.8（Reach=2 / Impact=1.0 / Confidence=0.8 / Effort=2.0）
- 根拠: 現時点では外部ブロッカー（typescript-eslint 未対応）があり着手不能。移行本体の技術コストは実測で小さいことが確認済み。トリガー発火までの維持コストは監視のみ

## 背景（実測・2026-09-26）

- `@typescript-eslint/eslint-plugin` / `parser` 8.70.1（npm latest）の peer 範囲は `typescript >=4.8.4 <6.1.0`
- TypeScript 7.0.2 をインストールした状態で他パッケージの `npm install` を実行すると **ERESOLVE エラーで失敗する**（jsdom 更新試行時に実測）。つまり TS 7 はツールチェーン全体を巻き込んで不動化する
- TypeScript 7.0.2 単体の品質は良好（仮適用して実測）:
  - `npm run type-check`（本体）: エラー 0 件
  - `npm run type-check:test`: 型エラーの発生箇所数は TypeScript 6.0.3 と同一（既存 278 件は先行ドリフト。差分はエラーメッセージの表記揺れのみ）
  - vitest の実行時テストは tsc に依存しないため、ランタイム影響は別途 `npm run validate` で確認する
- なお `type-check:test` は CI / release gate に入っておらず、既存の 278 件は本 PBI のスコープ外（test 型チェックの恒常化は別途）

## トリガー（着手条件）

いずれかが成立したら着手する:

1. **上流リリース**: npm の `@typescript-eslint/eslint-plugin` で、peer 範囲に TypeScript 7.x を含む版がリリースされた
2. **フォールバック裁定**: `--legacy-peer-deps` 運用や typescript-eslint の更新断念をユーザーが明示的に裁定した（その場合は移行を中止し、判断を記録してクローズする）

監視方法（発火判断の手順）:

```bash
npm view @typescript-eslint/eslint-plugin version peerDependencies
```

2026-09-26 時点: latest 8.70.1、peer `typescript >=4.8.4 <6.1.0`。着手は不要。

2026-09-27 再調査（トリガー未発火の維持を確認）:

- npm 上の全リリース（canary 8.70.2-alpha.10 を含む）でも peer は `typescript >=4.8.4 <6.1.0` から変わらず。TypeScript 7 対応版は未リリース
- 上流の進捗: track issue [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)（Use TS 7 for type information）が team assigned で進行中。実装 PR は [typescript-eslint#12803](https://github.com/typescript-eslint/typescript-eslint/pull/12803)（TS 7.1 native parser の prototype、2026-09-26 時点で draft 未マージ、`parserOptions.projectService: { EXPERIMENTAL_backend: 'native' }` の形）
- 強行移行は非現実的と実証済み: TypeScript 7.0.2 は CJS exports を削除しており、`--force` / `--legacy-peer-deps` で入れると typescript-estree の require がクラッシュする（[typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518): `Cannot read properties of undefined (reading 'Cjs')`）
- 本プロジェクト側の追加ブロッカー: `typedoc` 0.28.20 の peer は `typescript 5.0.x〜6.0.x` に明示 pin（6.1.x 以降も未対応）。TS 7 移行時は typescript-eslint と typedoc の同時更新が必要
- `ts-node` 10.9.2 は peer `typescript >=2.7` でオープンだが、CJS exports 削除の影響を受ける可能性が未検証。移行手順で確認する

## 移行手順（トリガー発火後に実施）

1. `typescript@^7.0.2` と TypeScript 7 対応の `@typescript-eslint/eslint-plugin` / `parser`、および TypeScript 7 対応の `typedoc` を同時に更新する
2. `npm run type-check` と `npm run type-check:test` を実行し、エラー差分を記録する（実測では差分なし見込みだが、typescript-eslint 新版の parser 挙動変化に備えて再確認する）
3. `npm run lint` が TypeScript 7 で動作することを確認する
4. `npm run docs`（typedoc）と `ts-node` 経由のスクリプト（`npm run update-preset`）が TypeScript 7 で動作することを確認する
5. `npm run validate` 全ゲートが PASS することを確認する
6. `docs/DEPENDINGS.md` の「意図的に未反映の残り 1 件」表から `typescript` を除去する

## BDD受け入れシナリオ

```gherkin
Scenario: 上流が TypeScript 7 に対応した
  Given typescript-eslint の peer 範囲は現在 typescript <6.1.0 である
  When peer 範囲に typescript 7.x を含む新版が npm にリリースされる
  Then 着手トリガーが発火したと判断できる
  And 移行手順に従って typescript と typescript-eslint を同時更新する

Scenario: 移行後も全ゲートが PASS する
  Given typescript 7.0.2 と TypeScript 7 対応の typescript-eslint がインストールされている
  When npm run validate を実行する
  Then lint と type-check と全テストが失敗 0 件で完走する

Scenario: トリガー未発火時は現状を維持する
  Given typescript は 6.0.3 のままである
  When npm install を実行する
  Then ERESOLVE エラーなしで完了する
```

## 受け入れ基準

- [ ] トリガー待ちである旨と、上流対応まで実装しない旨が本 PBI に明記されている（起票済み）
- [ ] （トリガー発火後）`package.json` の `typescript` を `^7.0.2` に更新し、TypeScript 7 対応の `@typescript-eslint/*` と `typedoc` を同時に `package-lock.json` へ同期している
- [ ] （トリガー発火後）`npm run validate` が PASS する
- [ ] （トリガー発火後）`docs/DEPENDINGS.md` を更新している

## テスト戦略

- E2E: なし
- 統合: `npm run validate`（`npm run lint` が typescript-eslint の project service で TypeScript 7 を解釈できるかの実質テストになる）
- 単体: なし

## 見積もり

2 SP（トリガー発火後の実施分。難易度 🟡中 — 本体の型エラーは実測 0 だが、lint パイプラインと typescript-eslint 新版の組合せ確認が必要）

## DoD

- [ ] 起票済み（トリガー・監視方法・移行手順の記載）
- [ ] （トリガー発火後）上記受け入れ基準を満たし、`docs/DEPENDINGS.md` を更新する

## 参考

- `docs/DEPENDINGS.md` — 依存棚卸しと未反映理由の記録
- 同型の監視 PBI: [2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md](2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md)（上流リリース待ちのトリガー型 PBI の先行例）
