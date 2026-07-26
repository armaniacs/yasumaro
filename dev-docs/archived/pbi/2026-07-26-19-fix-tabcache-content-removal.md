# PBI: TabCacheからcontentフィールドを削除しモバイルメモリ使用量を削減する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（TabCacheのcontent取得元をContent Script直接取得に変更するため、既存のcontentを前提とする呼び出し元の修正が必要）

## 実装メモ（2026-07-26）

フェーズ0確認で、`TabData.content`は`initialize()`/`add()`時に常に`null`で設定され、`update()`経由で
非null値を設定している呼び出し元がプロジェクト全体を検索してもゼロであることを確認した。
`messageHandlers.ts`等で見つかった`.content`参照は全て`message.payload.content`（メッセージの
payload）であり、`TabData.content`とは無関係だった。

つまりPBIが想定していた「Content Script経由での代替取得ロジックへの置き換え」は不要で、単純に
`content`フィールドを型定義・初期化箇所（2箇所）から削除するだけで対応できた（当初想定より
大幅に小さい変更で完了）。

既存テスト（`tabCache.test.ts`）に`content`フィールドを直接検証する箇所が2件あり、
`toEqual`完全一致検証と`update()`の汎用性テストとして`content`という名前を使っていた。
前者はフィールドごと削除、後者は削除済みフィールド名を使い続けるのが紛らわしいため
`isValidVisit`（既存フィールド）を使う形に修正した。

型チェック・全テストスイート（7371件、tabCache.test.ts 23件含む）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Edge & Mobile Strategist からの指摘。`src/background/tabCache.ts:13-163` で全タブの最大10KBコンテンツがメモリに常駐している。モバイル端末で20タブ開いている場合 ~200KB + メタデータのメモリ消費が発生する。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "content" src/background/tabCache.ts
grep -rln "tabCache" src/background/*.ts | xargs grep -n "\.content\b" 2>/dev/null
```

`TabCache` の `content` フィールドを実際に読んでいる呼び出し元を全て洗い出す。これらの箇所を「必要時にContent Scriptへメッセージを送って取得する」形に置き換えられるか、レイテンシ増加の許容範囲を確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: TabCacheがcontentフィールドを保持しない
  Given TabCacheの型定義
  When contentフィールドを削除する
  Then TabCacheのメモリ使用量が大幅に削減される（メタデータのみ保持）

Scenario: contentが必要な箇所は都度Content Scriptから取得する
  Given contentを必要とする既存の呼び出し元
  When TabCacheからcontentを削除した後
  Then chrome.tabs.sendMessage経由でContent Scriptから直接コンテンツを取得する

Scenario: 既存の記録フローが回帰しない
  Given contentをContent Script直接取得に変更した後
  When 記録フロー全体（AI要約含む）を実行する
  Then 既存と同じ結果が得られる（取得に若干のレイテンシが追加される可能性はあるが機能的に等価）
```

## 受け入れ基準
- [ ] `TabCache` の型定義から `content` フィールドを削除する
- [ ] `content` を参照している呼び出し元を、Content Script経由での直接取得に置き換える
- [ ] 既存の `tabCache` 関連テストが全てパスする
- [ ] メモリ使用量の削減を確認する（開発者ツールでの手動確認、または簡易ベンチマーク）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `TabCache` の型からcontentが削除されていることを確認（型チェック）
- content取得元を置き換えた呼び出し元が正しく動作することを確認

### 統合テスト
- 記録フロー全体（タブのコンテンツ取得→AI要約→保存）が回帰しないことを確認

## 実装アプローチ

1. `tabCache.ts` の `content` フィールドを参照する全呼び出し元を洗い出す
2. 各呼び出し元をContent Script経由の直接取得に置き換える
3. `TabCache` からcontentフィールドを削除
4. 回帰テストを実施

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/content/loader.ts`（Content Script側のメッセージハンドラー）
- テスタビリティ: 既存のtabCacheテストが土台
- 非機能要件: モバイル対応、メモリ使用量削減

## Definition of Done
- [ ] TabCacheからcontentフィールドが削除されている
- [ ] 呼び出し元がContent Script直接取得に置き換わっている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Edge & Mobile Strategist指摘）
- 対象コード: `src/background/tabCache.ts:13-163`
