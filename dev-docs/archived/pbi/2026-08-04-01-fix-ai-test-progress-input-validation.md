# PBI: AI_TEST_PROGRESS 受信パスの入力検証をハードニングする

**作成日**: 2026-08-04
**優先度**: 中（次リリースまでに対応）
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（受信側の検証追加のみ、既存挙動を壊さない）
**種別**: fix（レビュー指摘: Blue Team [Low]、Refactoring [Low]）

---

## 背景（5 Whys 分析）

Checking Team レビュー（`plans/2026-08-04-1950-review-v6.7.12-ai-test-progress.md`）の以下2指摘を起点とする:

- Blue Team [Low]「PROVIDER_LABELS へのプロパティアクセスがプロトタイプ継承キーを拾う」
- Refactoring [Low]「isAiTestProgressMessage が progress ペイロードの形状を検証しない」

### 5 Whys

- **Why 1**: なぜ listener が不正なペイロードを受け入れるのか？
  → `isAiTestProgressMessage` が `type === 'AI_TEST_PROGRESS'` の一致のみ判定し、`progress` の形状（provider が string、index/total が非負整数）を検証しないため。
- **Why 2**: なぜ型一致のみで十分としたのか？
  → 送信元が自 Service Worker の notifier であると「信頼できる」前提を置き、type チェックで足りると判断したため。
- **Why 3**: なぜ送信元を信頼してよいと仮定したのか？
  → `chrome.runtime.sendMessage` の broadcast が「自拡張のコンテキストのみに届く」と誤って理解していたため。実際は content script・offscreen・popup など全拡張コンテキストに届く。
- **Why 4**: なぜ sender 検証だけでは不十分なのか？
  → sender が自拡張でも、読み込み済みの page script / 乗っ取られた content script が偽メッセージを送れる。また sender 検証と payload 検証は直交する防御層であり、片方では入力検証の穴が残る。
- **Why 5**: なぜ payload 検証を当初から入れなかったのか？
  → 一方向 broadcast は「request/response の厳密な検証レイヤ（service-worker.ts の VALID_MESSAGE_TYPES）から意図的に外した」設計で、受信側に個別検証を強制する仕組みが無かったため。

### 根本原因
broadcast 受信パスが防御的設計（sender origin + payload schema の複数層検証）を欠いたまま「信頼済み push」として実装され、`PROVIDER_LABELS[provider]` のプロトタイプ継承キー漏れ（`constructor` 等）と形状不正メッセージを拾う余地が残った。

### 対処
受信側で (1) sender.id 検証（対応済み）、(2) `progress` ペイロードの形状検証、(3) `PROVIDER_LABELS` への防御的アクセス（`hasOwnProperty`）を追加する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 形状不正な AI_TEST_PROGRESS を無視する
  Given 自拡張 sender から、index が文字列である不正な progress を持つ AI_TEST_PROGRESS が届く
  When ダッシュボードの progressListener が受信する
  Then 描画は行われず、既存の表示が維持される

Scenario: プロトタイプ継承キーを provider に指定してもラベルが汚染されない
  Given 不正な provider 名 "constructor" を持つ progress が届く
  When ラベルを解決する
  Then ラベルは "constructor"（そのままの生値）として表示され、関数ソースや [object Object] にならない

Scenario: 正常な progress は従来通り描画される
  Given 自拡張 sender から正しい形状の AI_TEST_PROGRESS が届く
  When progressListener が受信する
  Then プロバイダー名・進捗が従来通り描画される
```

## 受け入れ基準
- [ ] `isAiTestProgressMessage` が `progress.provider`（string）と `progress.index`/`progress.total`（非負整数）を検証する
- [ ] `PROVIDER_LABELS[provider]` を `Object.prototype.hasOwnProperty` で保護し、未登録プロバイダは生値をフォールバックする
- [ ] 形状不正・未登録キーの場合も DOM XSS や表示汚染に至らない
- [ ] 既存の進捗表示テストが全てパスする

## テスト戦略
- 単体: `src/dashboard/__tests__/dashboard-handlers.test.ts` に「形状不正の AI_TEST_PROGRESS を無視」「`constructor` を provider に指定してもラベル汚染しない」ケースを追加
- 既存の正常系・偽 sender 無視テストを維持

## 実装アプローチ
- **Outside-In / Red-Green-Refactor**: テストを追加し失敗確認 → `isAiTestProgressMessage` とラベル解決を実装 → グリーン化

## Definition of Done
- [ ] 形状検証・防御的アクセスが実装済み
- [ ] 対応テストが追加され全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- レポート: `plans/2026-08-04-1950-review-v6.7.12-ai-test-progress.md`（Blue Team Low、Refactoring Low）
- 対象コード: `src/dashboard/dashboard.ts`（`isAiTestProgressMessage`, `renderAiTestProgressLabel`）
