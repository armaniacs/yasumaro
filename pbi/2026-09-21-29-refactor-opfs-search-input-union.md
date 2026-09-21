# PBI: RunOpfsSearchArgs の searchInput を判別共用体にして誤用を型で防ぐ

種別: refactor
見積もり: 1pt
優先度: 順位 4 / RICE 6（Reach 3 / Impact 0.5 / Confidence 1.0 / Effort 0.25 週）
根拠: prose 契約の型化

## ユーザーストーリー

検索機能を保守する開発者として、`RunOpfsSearchArgs` の `searchInput` を判別共用体に変更してほしい、なぜなら現状は `path` 依存の 2 意味（FTS 用の加工済みクエリと LIKE 用の生 term）を 1 つの `string` field に prose コメントだけで区別しており、生 term を fts path に渡す誤用が型では防げず静かに誤クエリになるから。

## ビジネス価値

検索入力の誤用をコンパイル時に検出できるようにする。prose による契約を型に置き換えることで、将来の呼び出し側追加時の誤クエリ混入を構造的に防ぎ、レビュー負荷と回帰調査コストが下がる。挙動自体は不変であり、利用者への影響はない。

## BDD受け入れシナリオ

```gherkin
Scenario: FTS path は加工済みクエリのみ受け付ける
  Given path が fts である判別共用体の入力がある
  When  buildFtsMatchQuery 出力を ftsQuery として渡して検索を実行する
  Then  統一前と byte 等価の SQL 文・params 順序・rows・total が返る

Scenario: LIKE path は生 term のみ受け付ける
  Given path が like である判別共用体の入力がある
  When  生 term を rawTerm として渡して検索を実行する
  Then  buildLikePattern 適用後の SQL 文・params が統一前と byte 等価になる

Scenario: 誤った組み合わせは型で拒否される
  Given path が fts である入力に生 term を渡そうとする呼び出しがある
  When  型検査を実行する
  Then  コンパイルが失敗し実行時の誤クエリにならない
```

## 受け入れ基準

- [ ] `searchInput` が `{ path: 'fts'; ftsQuery: string } | { path: 'like'; rawTerm: string }` の判別共用体になり `path` field と統合されている
- [ ] `buildLikePattern` の適用が union 消費点の 1 箇所に限定されている
- [ ] FTS path に生 term を渡す誤用が型検査で拒否される
- [ ] SQL 文・params 順序・rows・total が変更前と byte 等価である（挙動不変）
- [ ] 既存の pin スナップショットが無変更で green である
- [ ] 全 BDD シナリオが実装されパスしている

## テスト戦略

t_wada スタイル（Outside-In TDD）で進める。まず受け入れレベルのテストとして、FTS path と LIKE path の各入力について変更前後での SQL 文・params 順序・rows・total の byte 等価を検証するテストを書く（Red）。次に判別共用体への変更を実装して Green にする。単体テストでは `fts` には `ftsQuery` のみ、`like` には `rawTerm` のみを受け付ける型の対応表と、`buildLikePattern` が like branch の 1 箇所でのみ適用されることを検証する。型の拒否は型検査の失敗として確認し、既存の検索系テスト一式と pin スナップショットが全て Green であることを確認する。

## 実装アプローチ

`RunOpfsSearchArgs` の `searchInput: string` と `path: SearchPath` を `{ path: 'fts'; ftsQuery: string } | { path: 'like'; rawTerm: string }` の判別共用体に置き換える。`runOpfsSearch` 内の `isFts` 三項によるオーバーロード解消を union の分岐に書き換え、`buildLikePattern` の適用を like branch の消費点 1 箇所へ移動する。呼び出し側の `handleSearchFts` と `handleSearchLike` は既に種別を知っているため、それぞれ対応する variant を構築する。SQL 文組立の builder 自体には触らない。

## 見積もり

1pt（0.25 週想定）。挙動不変のリファクタであり、新規機能や SQL 文自体の変更は含まない。

## 技術的考慮事項

- 現状の `searchInput: string` は path 依存の 2 意味を prose コメントで区別する契約であり、型検査の対象外であるため誤用が実行時まで検出されない
- `buildLikePattern` の適用点は fts と like の分岐の片 branch にあり、union 化後は消費点の 1 箇所に集約することで適用漏れと二重適用の両方を防ぐ
- 判別子は既存の `path` field と統合し、新しい判別子を追加して 2 重に path を持たせないこと
- byte 等価が前提であり、既存 pin スナップショットの無変更 green をもって挙動不変を裏付ける

## 実装者向け注記

- Evidence 1: `src/offscreen/searchExecution.ts:41-45` 付近の `searchInput: string` は 1 field に path 依存の 2 意味を prose で文書化している（FTS は `buildFtsMatchQuery` 出力、LIKE は生 term で `buildLikePattern` は内部適用）
- Evidence 2: `src/offscreen/searchExecution.ts:84-92` 付近の `isFts` 三項は `buildLikePattern` を片 branch のみに適用しており、本 PBI のオーバーロード解消点である
- Evidence 3: `src/offscreen/opfsWorker/searchHandlers.ts:35` 付近は `buildFtsMatchQuery(bare)` の出力を渡し、`src/offscreen/opfsWorker/searchHandlers.ts:37` 付近は raw の `searchQuery` を渡しており、呼び出し側は既に種別を知っている
- 既知の failure 構造: 生 term を fts path に渡す誤用が静かに誤クエリになる（型では防げない）

## Definition of Done

- [ ] 全 BDD シナリオが実装されパスしている
- [ ] コードレビューが完了している
- [ ] 統合検証が green である
