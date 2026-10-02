# PBI: domain filter デフォルト値の三者不一致を解消する

種別: fix (C7, RICE #6)

## ユーザーストーリー

ドメインフィルタの初期状態を信頼したいユーザーとして、どの層を見ても既定値が一貫していてほしい。層ごとに既定が食い違うと有効・無効の判定が環境依存になり、想定外の記録・除外が起きるから。

## 背景

ドメインフィルタの既定値が 3 箇所で別々に定義されており、単一の正 (SSOT) が存在しない。いずれを正とするかの裁定と三者の整合が必要。

## スコープ (file:line)

- `src/utils/storage/defaults.ts:66`
- `src/background/cache/domainFilterCache.ts:37`
- `src/background/cache/domainFilterCache.ts:84`
- `src/background/domain/DomainFilter.ts:125-133`

## BDD 受け入れシナリオ

```gherkin
Scenario: 既定値が全層で一致する
  Given ドメインフィルタの設定が未保存 (初期状態) である
  When いずれの層 (defaults / cache 初期値 / DomainFilter) から既定値を読む
  Then すべて同一の単一既定値が返る

Scenario: 裁定が記録される
  Given 3 箇所の既定値が異なっていた
  When 本 PBI で単一既定値を選ぶ
  Then 選定理由が本 PBI に記録されている
```

## 受け入れ基準 (file-scoped)

- [ ] 単一の既定値が裁定され、選定理由が本 PBI に記録されている (`defaults.ts:66` / `domainFilterCache.ts:37,84` / `DomainFilter.ts:125-133` のいずれを正としたか明示)
- [ ] `src/utils/storage/defaults.ts:66` が裁定値と一致している
- [ ] `src/background/cache/domainFilterCache.ts:37` が裁定値と一致している
- [ ] `src/background/cache/domainFilterCache.ts:84` が裁定値と一致している
- [ ] `src/background/domain/DomainFilter.ts:125-133` が裁定値と一致している
- [ ] 既存 DomainFilter テストが green である
- [ ] 3 層の既定値を横断比較する default-matrix テストが新規追加されている

## テスト戦略

- 単体: 既存 DomainFilter テスト green 維持
- 単体 (新規): defaults / cache (2 箇所) / DomainFilter の既定値をマトリクス比較し、不一致で失敗するテスト
- 統合: `npm run validate` が通ること

## 振る舞い変更ルール (fix)

- 振る舞い変更は既定値の統一 1 点のみに限定する (フィルタ判定ロジック自体の変更は別 PBI)
- 裁定で選ばれなかった既定値に依存していた既存テストは、理由を添えて更新し、沈黙の削除をしない
- 移行 (migration) が必要な場合は別 PBI で裁定し、本 PBI では既定値の読みのみを揃える

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
