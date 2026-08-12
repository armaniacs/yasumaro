# PBI: RecordingPipelineのオフライン再試行ポリシーを宣言化する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー
開発者として、RecordingPipelineの各stepが自分のオフライン再試行方針を明示してほしい。なぜなら、step名の変更で再試行が黙って無効になる事故を防ぎ、データ保全の意図をテストしたいから。

## 調査結果
`RecordingPipeline.ts` のstep tableと `enqueueOfflineJob` を確認した。現在は `saveObsidian`、`extractSentences`、`privacyPipeline` などの文字列照合で対象とjob種別を決めている。本PBIは既存挙動の宣言化であり、新しい再試行対象を追加するものではない。

対象:
- `src/background/pipeline/RecordingPipeline.ts`
- offline queue関連module
- recording pipelineの単体・統合テスト

## 5 Whys
1. なぜstep名変更で再試行が止まるのか。対象判定が文字列の完全一致に依存しているから。
2. なぜjob種別も壊れるのか。job種別をstep名から逆引きしているから。
3. なぜstep名から逆引きするのか。step metadataに再試行方針とjob種別がないから。
4. なぜmetadataがないのか。実行順序・error strategy・retry設定だけをstep tableへ持たせたから。
5. なぜリスクが見逃されたのか。stepの名前変更や新規step追加を検出するcontract testがないから。

根本原因: RecordingPipelineの実行stepとoffline queueの意味が別々の文字列知識として存在する。

## BDD受け入れシナリオ

```gherkin
Scenario: オフライン再試行対象のstepが失敗する
  Given ネットワーク依存のstepが再試行対象として設定されている
  When そのstepが一時的な通信障害で失敗する
  Then 対応するoffline jobがキューへ追加される
  And job種別がstepの宣言と一致する

Scenario: 再試行対象外のstepが失敗する
  Given stepがオフライン再試行対象外として設定されている
  When そのstepが失敗する
  Then offline jobを追加しない
  And 既存の失敗戦略を適用する

Scenario: step名を変更してもポリシーが変わらない
  Given stepの表示名または識別名を変更する
  When 同じstepを実行する
  Then 宣言された再試行可否とjob種別が維持される
```

## 受け入れ基準
- [ ] オフライン再試行可否がstep tableの宣言データから決まる。
- [ ] job種別がstep名の文字列比較から決まらない。
- [ ] 既存の各stepの再試行挙動が維持される。
- [ ] 対象外stepが誤ってqueueへ入らない。
- [ ] step追加・名前変更時にmetadata漏れをテストで検出できる。
- [ ] offline queueへ渡すpayloadが従来と互換である。

## テスト戦略（TDD）

### Outside-In手順
1. offline queue統合テストで対象stepのjob追加をRedで固定する。
2. 対象外stepとjob種別不一致のテストを追加する。
3. step metadataの単体テストを追加する。
4. `enqueueOfflineJob` の文字列判定を宣言metadata参照へ置き換える。
5. Green後に重複したstep名リストを削除する。

### 統合テスト
- `saveObsidian` 相当の失敗が `obsidian_sync` になる。
- AI要約相当の失敗が `ai_summary` になる。
- privacy/extractなど既存対象のjob種別が維持される。
- 対象外stepはqueueへ入らない。
- queue保存失敗時の既存エラー処理が維持される。

### 単体テスト
- metadataの既定値。
- retryable true/false。
- job kindの明示値。
- 空・未知のjob kindを拒否する。
- step名変更後も同一metadataが適用される。
- 全stepが必要metadataを持つ網羅性。
- error strategyとoffline policyの組み合わせ。

## 実装手順
1. `RecordingPipeline.ts` の全stepと現在の文字列判定を表にする。
2. 既存テストから各stepの期待job種別と失敗挙動を確認する。
3. まず対象・対象外・job種別の統合テストを追加する。
4. step tableへオフライン再試行metadataを追加する。
5. `enqueueOfflineJob` をmetadataだけ参照する処理へ変更する。
6. step名の文字列リストとjob種別の条件分岐を削除する。
7. 全stepのmetadata網羅性テストを追加する。
8. 既存payload、retry回数、queue保存処理を変更していないことを確認する。
9. 関連テストと型チェックを実行する。

## 落とし穴
- 単に文字列を定数化するだけでは根本原因を解消しない。
- step名とjob種別は同じ概念ではないため、名前から推測しない。
- retry回数やerror strategyを意図せず変更しない。
- privacy pipelineの失敗時に機密情報をqueue payloadへ追加しない。

## 見積もり
2ポイント。PBI-01〜04とは比較的独立しており、先行実施も可能。

## Definition of Done
- [ ] offline policyとjob種別がstep metadataに集約される。
- [ ] 文字列照合によるポリシー判定が削除される。
- [ ] BDD、統合、単体テストが成功する。
- [ ] 既存の再試行回数とqueue payloadが維持される。
- [ ] `npm run type-check` が成功する。
- [ ] コードレビューが完了する。
