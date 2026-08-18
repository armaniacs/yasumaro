# PBI: `allowJs` を無効化して TypeScript のみの型チェック対象に統一する

## ユーザーストーリー
開発者として、プロジェクトの型チェック対象を TypeScript のみに統一したい。なぜなら、現在 `tsconfig.json` に `allowJs: true` / `checkJs: true` が設定されており、`src/utils/trustDb/bloomfilter-vendor.mjs`（ベンダーJS）が型チェック対象に混入し、import に `@ts-ignore` が必要な状態になっているから。

## 優先度
- 順位: 05 / 06
- RICEスコア: 22.5（Reach=15 / Impact=0.5 / Confidence=90% / Effort=0.3人週）
- 根拠: 影響は軽微（JS 追加は稀）だが、コストが極小な上に確信度が高い。ただし `allowJs: false` 単独ではベンダー import が型解決不能になるため、`.d.ts` 用意が前提条件。クイックウィンとして基盤整備（PBI 02/03）の合間に着手可能。

## ビジネス価値
- 型チェック対象を TS に限定し、JS ファイルが「型の抜け道」になるのを防ぐ
- `@ts-ignore`（現在1件）を解消し、ベンダー import を型安全にする

## 背景（2026-08-18 調査済み）
`tsconfig.json` に `allowJs: true` と `checkJs: true` が設定されている。`src/` 配下の非TSソースは1ファイルのみ:

- `src/utils/trustDb/bloomfilter-vendor.mjs`（245行、bloomfilter npm パッケージのベンダーコピー）
- `src/utils/trustDb/bloomFilter.ts:7` で `import { BloomFilter } from './bloomfilter-vendor.mjs'` として参照し、`// @ts-ignore — vendor JS file bundled from bloomfilter npm package` が付与されている

`allowJs: false` に変更すると、この import の型が解決できず `npm run type-check` が失敗する。したがって、ベンダーモジュールに手書きの `.d.ts`（`BloomFilter` の公開APIのみ宣言）を用意してから無効化する必要がある。

## BDD受け入れシナリオ

Scenario: `allowJs` を無効化してもビルド・型チェックが通る
  Given `bloomfilter-vendor.mjs` の公開APIを宣言する `.d.ts` が用意されている
  When `tsconfig.json` の `allowJs` を `false` に変更し `npm run type-check` を実行する
  Then 型エラー0件で終了する

Scenario: JS ファイルの追加が型チェック対象にならない
  Given `allowJs` が `false` である
  When 誰かが `src/` 配下に `.js` / `.mjs` を追加する
  Then そのファイルは型チェック対象に含まれない（TS only が維持される）

Scenario: ベンダー import から `@ts-ignore` が消える
  Given ベンダーモジュールに `.d.ts` が用意されている
  When `bloomFilter.ts` が `bloomfilter-vendor.mjs` を import する
  Then `@ts-ignore` なしで型解決され、`@ts-ignore` の総数が0件になる

## 受け入れ基準
- [ ] `bloomfilter-vendor.mjs` の公開API（`BloomFilter` クラスと使用メソッド）を宣言する `.d.ts` が追加される
- [ ] `bloomFilter.ts:7` の `@ts-ignore` が削除される
- [ ] `tsconfig.json` の `allowJs` が `false` に変更される（`checkJs` は不要になるため削除 or 無効化）
- [ ] `npm run type-check` がエラー0件で終了する
- [ ] 本番コードの `@ts-ignore` が0件になる

## テスト戦略
- 静的: `npm run type-check` が `allowJs: false` 下で成功すること
- 単体: `TrustBloomFilter`（`bloomFilter.ts`）が既存の通り動作すること（ベンダーAPI呼び出しの回帰）
- 静的: `@ts-ignore` の総数が0件であることの確認

## 実装アプローチ
1. `bloomfilter-vendor.mjs` の実際に使われている公開APIを確認する
2. `bloomfilter-vendor.d.mts`（または `.d.ts`）を手書きし、`BloomFilter` のシグネチャを宣言する
3. `bloomFilter.ts` の `@ts-ignore` を削除して型解決を確認する
4. `tsconfig.json` の `allowJs` を `false` に変更し、`npm run type-check` で全体確認する

## 見積もり
1pt（🟢低）

## 技術的考慮事項
- `.mjs` ファイルの型宣言は `.d.mts` を使う（NodeNext のモジュール解決に整合）
- ベンダーJSをTSに書き換える（再実装）と著作権・ライセンス・メンテナンスの観点で問題があるため、`.d.ts` 追加のみに留める

## Definition of Done
- [ ] ベンダー `.d.ts` が追加され、`@ts-ignore` が0件
- [ ] `allowJs: false` で `npm run type-check` 成功
- [ ] 既存テストパス
- [ ] コードレビュー完了
