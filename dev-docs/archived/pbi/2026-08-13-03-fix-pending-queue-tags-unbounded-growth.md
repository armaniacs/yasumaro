# PBI: pendingChromeStorageQueueのマージ後ペイロードを合計サイズで検証し、tags無制限肥大化を防ぐ

## ユーザーストーリー
Yasumaro拡張機能のユーザーとして、記録の失敗が繰り返されてもchrome.storage.localのクォータが特定の1エントリの肥大化によって圧迫されないでほしい、なぜなら他の正常な保存処理まで巻き込んで失敗するようになると、拡張機能全体が使えなくなるから。

## ビジネス価値
記録失敗（ネットワーク不調、Obsidianサーバーダウン、AIプロバイダのレート制限等、日常的に起こりうる障害）が繰り返された際に、再試行キューの1エントリが無制限に肥大化してストレージクォータを圧迫し拡張機能全体の保存を止めてしまう事態を防ぐ。攻撃者の悪意を必要とせず、通常の障害シナリオだけで発生しうるため、信頼性に直結する。

## 背景・根本原因（なぜなぜ分析より）
`src/background/pendingChromeStorageQueue.ts` の `enqueuePendingWrite()` は、同一URLの`metadataPatch`が既にキューにある場合、既存パッチと新規パッチをマージする（72-101行目）。マージ後のサイズチェック（90-98行目）は`content`フィールドの有無のみを見て、サイズ超過時に`content`を間引く。しかし`tags`（79行目、`Set`で無制限に結合）を含む他のフィールドには一切の上限がなく、`content`が既に空でも`tags`だけでペイロードが際限なく肥大化しうる。

さらに、このマージ経路（`queue.save(existing)`、99行目）は`PersistentRetryQueue.enqueue()`を経由せず直接`save()`を呼ぶため、汎用キュークラス側が持つ`maxPayloadBytes`ガード（`persistentRetryQueue.ts`、`item.payload`フィールドの有無で判定）も適用されない。加えて`PendingMetadataPatchWrite`は`payload`ではなく`patch`フィールドを使うため、仮に`enqueue()`を経由したとしてもこのガードは`payload === undefined`により実質no-opになる。

根本原因は、`PersistentRetryQueue`の汎用サイズガードが「新規追加」ユースケースのみを想定して設計されており、後から追加された「既存エントリのマージ（更新）」ユースケースがこのガードを経由せず`save()`を直接呼ぶ形で個別実装されたため、汎用クラスが持つはずのサイズ制御が及ばない経路が生まれたこと。かつ`content`専用の間引きロジックが、`tags`のような他フィールドの累積肥大化を想定していないこと。

## 修正方針
`pendingChromeStorageQueue.ts`内のマージ後サイズチェック（90-98行目）を拡張し、`content`を間引いた後も`MAX_PATCH_PAYLOAD_BYTES`を超えている場合は`tags`も上限件数まで切り詰める。加えて、`MAX_PATCH_PAYLOAD_BYTES`定数が91行目・109行目の2箇所に重複しているため、モジュールスコープの単一定数に統合する。

`PersistentRetryQueue`側の汎用API拡張（`upsert()`新設等）は今回のスコープ外とし、`pendingChromeStorageQueue.ts`内で完結する最小修正とする。

## スコープ
- 対象: `src/background/pendingChromeStorageQueue.ts` の `enqueuePendingWrite()` 内のマージ処理のみ
- 対象外: `PersistentRetryQueue`（`persistentRetryQueue.ts`）自体のAPI変更（`upsert()`新設等）
- 対象外: legacy（`type`フィールドを持たない）書き込みの`isRetryable`扱いや`ttlMs`/`maxRetryCount`の適用範囲見直し（別問題であり本PBIでは扱わない）

## BDD受け入れシナリオ

```gherkin
Scenario: content間引き後もtagsが大きい場合はtagsも切り詰められる
  Given 同一URLに対するmetadataPatchが既にキューに存在し、既存のtagsと新規のtagsを結合すると要素数が非常に多くなる
  And マージ後のpatchのcontentは既に間引かれる、または元々存在しない
  When enqueuePendingWrite() を連続して複数回呼び出し同一URLへのマージを繰り返す
  Then マージ後のpatchの合計バイトサイズは MAX_PATCH_PAYLOAD_BYTES を恒久的に超えない
  And tagsは何らかの上限（件数または合計バイト数）で切り詰められ、キューエントリのサイズが増加し続けない

Scenario: 通常サイズのtags・contentはこれまで通り欠落なくマージされる
  Given 同一URLに対するmetadataPatchが1回だけキューに存在し、tagsとcontentがいずれも小さい
  When 2回目の同一URLへのenqueuePendingWrite()を呼び出す
  Then マージ後のtagsは両方の値を重複なく含み、切り詰めは発生しない
  And マージ後のcontentも間引かれずそのまま保持される
```

## 受け入れ基準
- [ ] マージ後の合計サイズが`MAX_PATCH_PAYLOAD_BYTES`を超える場合、`content`間引き後も超過していれば`tags`も上限まで切り詰める
- [ ] `MAX_PATCH_PAYLOAD_BYTES`定数の重複（91行目・109行目）をモジュールスコープの単一定数に統合する
- [ ] 同一URLへの連続マージ（例: 10回以上）をシミュレートしても、最終的なキューエントリのサイズが上限を超えないことをテストで確認する
- [ ] 通常サイズのtags/contentのマージ挙動に既存テストの回帰がないこと

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（Service Worker内部のキュー処理でありE2E環境での再現コストが高いため統合テストで代替）

### 統合テスト
- `enqueuePendingWrite()`を同一URLに対して複数回（例: 大量のtagsを持つpatchを繰り返し）呼び出し、`queue.load()`で取得した最終状態のペイロードサイズが上限を超えないことを検証する

### 単体テスト
- マージ後サイズが上限以下の場合、tagsが切り詰められないこと（既存挙動の維持）
- マージ後サイズが上限を超え、contentもtagsも存在する場合、まずcontentが間引かれ、それでも超える場合にtagsが切り詰められる順序であること
- tagsの切り詰めが「最新の情報を優先して残す」など明確なルールに従うこと（実装時にルールを決めて明文化する）

## 実装アプローチ
- **Outside-In**: 連続マージによる累積肥大化を検証する統合テストから書き始め、失敗を確認してから実装する
- **Red-Green-Refactor**: 現状のcontent間引きのみでは失敗するテストケース（tagsが原因で上限超過）を先に書き、tags切り詰めロジック追加でグリーンにする
- **リファクタリング**: グリーン後、`MAX_PATCH_PAYLOAD_BYTES`の重複解消も含めて整理する

## 見積もり
2pt 🟡（ロジック自体は小さいが、切り詰めルールの設計と累積シナリオのテストが必要）

## 技術的考慮事項
- 依存関係: なし（既存モジュール内で完結）
- テスタビリティ: `Blob`によるサイズ計算は既存コードのパターンを踏襲できる。テストでは`Array.from({length: N})`等で大量のtagsを生成し境界値を作る
- 非機能要件: tags切り詰めの具体的な上限値（件数 or バイト数）は実装時に決定する。過度に厳しい上限はユーザーの正当なタグ付けを損なうため、既存の典型的なタグ数（数個〜十数個程度）を大きく超える余裕を持たせつつ、無制限は避けるバランスが必要

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "MAX_PATCH_PAYLOAD_BYTES\|mergedPatch\|sameUrlIndex" src/background/pendingChromeStorageQueue.ts
```
確認済み: `src/background/pendingChromeStorageQueue.ts:69-119`の`enqueuePendingWrite()`が該当箇所。`MAX_PATCH_PAYLOAD_BYTES = 100 * 1024`が91行目と109行目に重複定義されている。マージ処理は72-101行目、新規エントリのサイズチェックは104-117行目。

### 実装手順
1. `MAX_PATCH_PAYLOAD_BYTES`をモジュールスコープの`const`として1箇所に定義し、91行目・109行目の重複を削除して参照に置き換える
2. 90-98行目のサイズチェックブロックを拡張する: `content`間引き後、再度`mergedSize`を計算し直し、なお超過していれば`tags`を切り詰める処理を追加する
3. tags切り詰めのルールを決める（例: 配列長の上限を設ける、または合計バイト数で古い順/新しい順に削る）。シンプルさを優先するなら「配列長に固定上限（例: 50件）を設け、それを超えたら末尾を切り詰める」から始める
4. 切り詰めが発生した場合、`contentOmitted`と同様に`tagsOmitted`のようなフラグをキューエントリに追加すると、デバッグ時に切り詰め発生を追跡しやすい（型定義`PendingMetadataPatchWrite`への追加が必要になる場合、既存の型定義ファイルを確認すること）

### 落とし穴
- `Blob`によるサイズ計算はテスト環境（jsdom）でも動作するか確認すること（既存コードで使われているため動作実績はあるはず）
- tags切り詰めの実装時、`Set`による重複排除の順序（挿入順）に依存した切り詰めロジックを書く場合、JavaScriptの`Set`が挿入順を保持する仕様に依存することを意識すること
- `mergeTags`フラグ（78行目）がfalseの場合はそもそもtagsのマージが行われず`{ ...existingPatch.patch, ...write.patch }`のスプレッドで新しい方のtagsに上書きされるだけなので、tags肥大化は`mergeTags: true`の場合にのみ発生する。切り詰めロジックもこの条件分岐の中に置くこと

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック+テスト）がグリーン
- [ ] コードレビュー完了
- [ ] リファクタリング完了（`MAX_PATCH_PAYLOAD_BYTES`重複解消済み）
- [ ] `pbi/00-INDEX.md`に本PBIの行を追加
