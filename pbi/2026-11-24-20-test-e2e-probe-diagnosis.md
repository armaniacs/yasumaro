# PBI: E2E の probe 初期化待ちの切り分けと重い spec の分離

## ユーザーストーリー
E2E を回す開発者として、probe 初期化のタイムアウトが起きたときにどこで止まったかが分かり、重い spec と同居させても誤った赤にならないようにしてほしい、なぜなら現状は一律 30 秒の poll で原因が分からず、負荷時に 11 件まとめて赤になり、再実行で緑と確認する手間がかかるから(2026-11-24 の全量実行で発生)。

## 優先度
- 順位: E2E 信頼性の改善。GA の必須ではない
- RICE: 要チームでの見積もり
- 根拠と依存: なし。後続の GA 作業を止めない

## ビジネス価値
- E2E の赤が製品の問題か環境の問題かを再実行なしで判断できる
- 測定方法: 人為的に各段階を壊したときに段階名付きの失敗になること。全量実行で probe 系の赤が再現しなくなること

## BDD受け入れシナリオ

```gherkin
Scenario: SW が止まっていると段階名付きで失敗する
  Given 拡張の SW が停止している
  When  probe 初期化待ちを実行する
  Then  「SW が応答しない」旨の失敗になり、content script の問題と区別できる

Scenario: armed されていないと段階名付きで失敗する
  Given SW は動いているが armed フラグが無い
  When  probe 初期化待ちを実行する
  Then  「armed されていない」旨の失敗になり、SW 停止と区別できる

Scenario: content script の注入遅延と区別できる
  Given armed 済みだが content script がまだ起動していない
  When  probe 初期化待ちを実行する
  Then  「content script の初期状態が無い」旨の失敗になり、30 秒の上限は維持される
```

## 受け入れ基準
- [ ] `waitForE2EProbeInit` が段階(SW 生存・armed・content 注入)を順に確認し、段階名付きの失敗を出す
- [ ] 実時間待ちの重い spec(滞在・スクロール・flood-guard 系)が分離され、全量実行と切り離して回せる(設定・タグ・別プロジェクトのいずれか)
- [ ] 固定 sleep を追加しない(条件待ちのまま)
- [ ] 日英どちらの UI 言語でも緑になる(ロケール依存の表明を残さない)

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 段階ごとの失敗を再現する spec(人為的に各段階を壊す)
- 重い spec の分離後の全量実行で緑を確認する

### 統合テスト
- 対象外(テスト基盤の改善のため)

### 単体テスト
- 対象外(テスト基盤の改善のため)

## 実装アプローチ
- **Outside-In**: 段階名付き失敗の再現テストから書き、赤を確認してから実装
- **Red-Green-Refactor**: TDD サイクルで進める

## 見積もり
2 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 各段階の人為的な破壊(SW 停止・armed なし・注入遅延)で確認できる
- 非機能要件: 配布ビルド(`OW_E2E_PROBE=0`)に probe コードが残らない性質を保つ
- ロールバック手段: fixture の差し戻しで現行動作に戻せる

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること。

```bash
git -C /Users/yaar/Playground/yasumaro grep -n "waitForE2EProbeInit\|readE2EProbeState\|enableE2EProbe" testDir/e2e/fixtures/e2eProbe.ts
git -C /Users/yaar/Playground/yasumaro grep -n "OW_PROBE_QUERY\|OW_PROBE_STATE" src/content/e2eProbeRelay.ts src/background/handlers/e2eProbeHandlers.ts
```

確認結果(2026-11-24 時点):
- 中継路: Node → SW → session(armed)→ content 起動 → OW_PROBE_QUERY → OW_PROBE_STATE → SW が session に書く → Node が poll(200ms 間隔・上限 30 秒)
- 失敗 11 件はすべてこの poll のタイムアウトで、再実行では緑。content-script-recording 5 件だけで 9.7 分かかった
- capture-late-rescan の A(5 秒の flood-guard 待ち)は負荷時に不安定で、再実行では緑
- similarity-cluster の英語決め打ちは日英両対応に修正済み

### 実装手順
1. 段階ごとの失敗再現テストを先に書く
2. `waitForE2EProbeInit` に段階確認を入れる
3. 重い spec を分離する
4. 全量実行で緑を確認する

### 落とし穴
- 固定 sleep を入れないこと
- 配布ビルドの kill switch を壊さないこと
- `chrome.i18n` はブラウザ UI 言語に固定されるため、`test.use({ locale })` だけでは英語にならないこと

## Definition of DoD
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] CHANGELOG への記載は不要(利用者向けの変更ではない)

## 引き継ぎ
状態: 実装済み。`1124a` に取込済み(`42fd9774f`)。`waitForE2EProbeInit` を 3 段階化し、実時間系 5 ファイルを `extension-heavy` に分離した。CI の `--grep @extension` 形状は維持され両 project が走る。
