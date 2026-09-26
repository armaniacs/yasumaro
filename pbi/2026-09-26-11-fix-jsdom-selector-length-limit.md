# PBI: クレンジングセレクタの長さ上限対策と jsdom 30.1.1 更新

## ユーザーストーリー

開発者として、クレンジングエンジンのセレクタ実行を jsdom 30.1.1 でも動作させたい。なぜなら同梱 dom-selector 9.x が導入した 2048 文字上限で 86 テストが失敗しており、このままだとテスト基盤（jsdom）を更新できず、セキュリティ修正やバグ修正を取り込めないから。

## 優先度

- 順位: 2 / 3（2026-09-26 依存更新ラウンド。採点の全体像は [2026-09-26-00-backlog-dependency-updates.md](2026-09-26-00-backlog-dependency-updates.md)）
- RICEスコア: 1.6（Reach=2 / Impact=1.0 / Confidence=0.8 / Effort=1.0）
- 根拠: 失敗の根因と修正位置を実測で特定済み。jsdom の更新経路を開通させるほか、セレクタ肥大による将来の再発をエンジン一点で防げる。順位1の `@types/chrome` 更新には依存しない

## 背景（実測・2026-09-26）

- `jsdom` 30.0.1 → 30.1.1 に更新すると `RangeError: Selector exceeds maximum allowed length of 2048` で 86 テストが失敗する（aiSummaryCleaner 系を中心に 15 ファイル）
- 原因: jsdom 30.1.1 が同梱する `@asamuzakjp/dom-selector` 9.x がセレクタ長の上限 `MAX_LENGTH = 2048` を導入した
- 実測した超過セレクタ（`buildClassIdSelectors` が `[class*="..."], [id*="..."]` をパターン数だけ連結して生成）:
  - `SELECTOR_RULE_DEFS.deep` の patterns: **4191 文字**
  - `SELECTOR_RULE_DEFS.jpLayout` の patterns: **4714 文字**
  - 他の行は 1013〜1464 文字。上限まで余裕が少なく、パターン追加で即超過しうる
- jsdom 側では回避不能: `Document-impl.js` が `new DOMSelector(globalObject, document, { idlUtils })` と構築しており、dom-selector が持つ `maxLength` オプションを jsdom の API から渡せない
- ブラウザ実行には影響しない（2048 上限は dom-selector 固有。Chrome の `querySelectorAll` に同上限はない）

## 推奨アプローチ

`stripBySelectors`（`src/utils/aiSummaryCleaner/selectorRules.ts`）の `collect()` を唯一の注入点として、カンマ区切りセレクタをチャンク分割してから `querySelectorAll` に渡す。

- 分割は意味論を変えない: カンマ区切りセレクタの照合結果は各セレクタの照合結果の和集合（union）であり、順序非依存
- 重複カウントは既存の counted Set が吸収するため、先祖と子孫が別チャンクで一致しても現行と同一の挙動になる
- 閾値は 2000 程度（安全係数付き）。1 セレクタ単位でチャンクを詰める
- 発生源（patterns 配列）の短縮は採用しない: パターンは今後も追加される（ドメイン対応・新規ルール）ため短縮方式では再発する。エンジンの一点で防御する方が単一所有（SSOT）になる

## BDD受け入れシナリオ

```gherkin
Scenario: 2048 文字を超えるセレクタでもクレンジングが動作する
  Given SELECTOR_RULE_DEFS.deep の patterns セレクタは 4191 文字である
  And SELECTOR_RULE_DEFS.jpLayout の patterns セレクタは 4714 文字である
  When jsdom 30.1.1 環境でクレンジングを実行する
  Then RangeError が発生せず該当要素を除去する

Scenario: チャンク分割しても重複カウントは壊れない
  Given 先祖要素と子孫要素が異なるチャンクのセレクタに一致する
  When stripBySelectors が行を実行する
  Then 各要素は一度だけカウントされ一度だけ削除される

Scenario: 更新後の全テストが PASS する
  Given jsdom を 30.1.1 に更新している
  When npm run validate を実行する
  Then テスト失敗 0 件で完走する
  And 更新前に 86 件失敗していた aiSummaryCleaner 系テストもすべて PASS する
```

## 受け入れ基準

- [ ] `collect()`（または同等の注入点）で長いカンマ区切りセレクタをチャンク分割する実装がある
- [ ] チャンク分割の単体テストがある（2048 ちょうど / 超過 / 極端に長い単一セレクタの境界を含む）
- [ ] `package.json` の `jsdom` を `^30.1.1` に更新し、`package-lock.json` も同期している
- [ ] `npm run validate` が PASS する（更新前の 86 失敗の解消を含む）
- [ ] クレンジングの除去対象集合が更新前と同一であることを、既存の aiSummaryCleaner 系テストで確認している
- [ ] `docs/DEPENDINGS.md` の「意図的に未反映の残り 3 件」表から `jsdom` を除去する

## テスト戦略

- E2E: なし（テスト基盤の更新。拡張機能の実行時挙動は変わらない）
- 統合: `npm run validate` 全体。加えて更新前に 86 失敗していた aiSummaryCleaner 系 15 ファイルを個別に実行して全 PASS を確認する
- 単体: チャンク分割ヘルパの境界値テスト（上限ちょうど / 1 文字超過 / 単一セレクタ自体が上限を超えるケース）。実時間待ちは使わない

## 見積もり

1 SP（難易度 🟢低〜🟡中。副作用 🟡軽微 — クレンジング動作は同一のはずだが、セレクタ実行が複数回になるため要検証点）

## DoD

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `docs/DEPENDINGS.md` が更新されている

## 参考

- `docs/DEPENDINGS.md` — 未反映理由の記録
- `src/utils/aiSummaryCleaner/selectorRules.ts` — `stripBySelectors` / `SELECTOR_RULE_DEFS`
- `src/utils/aiSummaryCleaner/helpers.ts` — `buildClassIdSelectors`（セレクタ生成源）
