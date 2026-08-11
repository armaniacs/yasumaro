# PBI: metadata patch queueのpayload容量を制御する

## ユーザーストーリー

開発者として、metadata patch queueが本文や要約によって無制限に肥大化しないようにしたい。なぜなら、storage障害中のretry queueがquotaとService Workerの処理時間をさらに圧迫し、復旧処理自体を失敗させる可能性があるから。

## ビジネス価値

- storage障害時にもretry queueが保存可能なサイズに収まる。
- 同一URLへの重複patchを統合し、復旧時の書き込み量を減らす。
- 大容量contentを失わず、保存不能時の扱いを明示できる。

## 実装済み確認

metadata patch queueと`MAX_PENDING_WRITES`は既に存在するが、contentやAI summaryを含むpayloadのbyte上限、同一URLの統合、容量超過時の契約は未実装である。これは既存queueの改善PBIである。

```bash
rg -n "metadataPatch|MAX_PENDING_WRITES|maxPayload|content|aiSummary" src/background/pendingChromeStorageQueue.ts src/background/pipeline/steps/saveMetadataStep.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: 通常サイズのmetadata patchをqueueへ保存する
  Given storageへのmetadata保存が失敗する
  And metadata patchが設定されたbyte上限以内である
  When patchをqueueへ追加する
  Then patch全体がqueueへ保存される
  And retry時に元のtimestampとmetadataが再現される

Scenario: 大容量contentを含むpatchをqueueへ追加する
  Given storageへのmetadata保存が失敗する
  And patchが設定されたbyte上限を超える
  When patchをqueueへ追加する
  Then queueのbyte上限を超えるpayloadは保存されない
  And contentの再取得または別保存経路を示す再試行情報が保持される
  And queue全体の既存jobは失われない

Scenario: 同一URLの未処理patchを統合する
  Given 同じURLに複数のmetadata patchがqueueへ存在する
  When 新しいpatchを追加する
  Then同一URLのpatchは定義されたfield merge規則で統合される
  And queue件数と総byte数が不要に増加しない
  And最新timestampと各fieldの値が保持される

Scenario: queue容量上限に到達する
  Given queueが件数またはbyte上限に到達している
  When 新しいpatchを追加する
  Then既存のqueue jobを無秩序に削除しない
  And追加失敗を呼び出し側へ明示する
  And次回retryで復旧可能な情報をログまたは状態として残す
```

## 受け入れ基準

- [ ] metadata patch payloadにbyte上限がある。
- [ ] queue件数上限とbyte上限が同時に適用される。
- [ ] 大容量content・AI summaryの保存方針が明示される。
- [ ] 同一URLの未処理metadata patchを安全に統合できる。
- [ ] timestamp、mergeTags、retry契約が維持される。
- [ ] 旧legacy payloadを読み取れる。
- [ ] queue容量超過時に既存jobが暗黙に失われない。
- [ ] type-check、関連テスト、buildが成功する。

## テスト戦略（Outside-In）

### E2Eテスト

- storage障害後のretryが通常サイズ・大容量contentで期待した復旧状態になることを確認する。

### 統合テスト

- queue追加、保存、flush、retryのbyte上限契約を検証する。
- 同一URLpatchの統合と旧payload互換を検証する。

### 単体テスト

- payload byte計算、上限境界、UTF-8文字列を検証する。
- field merge、timestamp優先順位、content分離・再取得情報を検証する。
- queue満杯、malformed payload、serialization failureを検証する。

## 実装アプローチ

- queue module内にpayload sizingとpatch coalescingの責務を集約する。
- adapterを増やさず、既存queueのinterfaceを維持する。
- contentをqueueから除外する場合は、再取得可能な識別子と明示的なretry状態を保存する。
- 上限値はコードへ直書きせず、既存のqueue設定と同じ定数方針に従う。

## 見積もり

3pt（高）

## 技術的考慮事項

- Chrome storageのserialization後byte数を基準にする。
- PIIを含むcontentをログへ出力しない。
- Service Workerのalarm retryと既存のallSettled実行を維持する。
- queue追加失敗がrecording成功結果へ変換されないようにする。

## Definition of Done

- [ ] BDDシナリオが自動テスト化されパスする。
- [ ] payload byte上限と件数上限が機能する。
- [ ] 同一URLpatchの統合が検証される。
- [ ] 旧payload互換とretryが維持される。
- [ ] type-check、validate、buildが成功する。
- [ ] コードレビューが完了する。
