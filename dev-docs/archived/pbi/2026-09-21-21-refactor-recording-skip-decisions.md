# PBI 21: recordingDecision seam に obsidian/L0 の skip 判定を合流させる

種別: refactor

## ユーザーストーリー

記録パイプラインを保守する開発者として、Obsidian 保存と L0 抽出の skip 判定を `recordingDecision` seam の純粋 predicate に合流させてほしい。なぜなら skip 政策（何が save と skip を決めるか）の知識が各 step 内に散在しており、判定経路のテストが step 全体を必要とするから。

## 優先度

順位 5 / RICE 20（Reach 5 / Impact 1 / Confidence 1.0 / Effort 0.25 週）

根拠: skip 政策の seam 集約により判定知識の散在を解消する。`extractSentencesStep.ts` を PBI 17 と共有するため 17 の後に実行する。

依存: PBI 17 の後に実行すること。`extractSentencesStep.ts` を共有するため。

## ビジネス価値

- skip 政策の変更点が `recordingDecision.ts` の単一箇所に集まり、仕様確認とレビューのコストが下がる
- 判定経路が純粋関数の単体テストで検証可能になり、step 全体を起動する重いテストが不要になる
- `checkDomainFilterStep` で確立済みの委譲パターンに揃えることで、パイプライン全体の一貫性が向上する

## BDD受け入れシナリオ

```gherkin
Scenario: Obsidian が無効な場合は保存を skip する
  Given obsidianEnabled が false である
  When decideSaveSkip に obsidianEnabled=false と clientPresent=true を渡す
  Then verdict は skip を返し、step は保存を実行せず context をそのまま返す

Scenario: Obsidian client が不在の場合は保存を skip する
  Given obsidianEnabled が true で client が不在である
  When decideSaveSkip に obsidianEnabled=true と clientPresent=false を渡す
  Then verdict は skip を返し、step は保存を実行せず context をそのまま返す

Scenario: L0 抽出が無効な場合は抽出を skip する
  Given L0_EXTRACTIVE_ENABLED が false である
  When decideL0 に enabled=false を渡す
  Then verdict は skip を返し、step は抽出を実行せず context をそのまま返す
```

## 受け入れ基準

- [x] `decideSaveSkip(obsidianEnabled, clientPresent)` が `recordingDecision.ts` に純粋 predicate として追加されている
- [x] `decideL0(enabled)` が `recordingDecision.ts` に純粋 predicate として追加されている
- [x] `saveToObsidianStep` が両 skip 分岐の verdict を predicate に委譲し、step 側は settings 読みと client 有無の I/O のみを持つ
- [x] `extractSentencesStep` が L0 有効判定の verdict を predicate に委譲し、step 側は settings 読みの I/O のみを持つ
- [x] 既存の skip 時の振る舞い（ログ内容・早期 return・例外を投げないこと）が変化していない
- [x] 全 BDD シナリオに対応するテストが追加され green である

## テスト戦略

t_wada スタイルの Outside-In で進める。まず `decideSaveSkip` と `decideL0` の振る舞いを定義する単体テストを Red で書き、predicate 実装で Green にする。次に各 step の委譲テストを書き、無効時と client 不在時に保存や抽出が実行されず context がそのまま返ることを確認する。最後に既存の step テスト全体を実行し、振る舞いの変化がないことを確認してからリファクタする。I/O（settings 読み・client 有無の解決）と verdict（純粋判定）の境界をテストで固定し、副作用を持たない predicate だけを直接検証する。

## 実装アプローチ

1. `recordingDecision.ts` に `decideSaveSkip(obsidianEnabled, clientPresent)` を追加する。`obsidianEnabled === false` または client 不在の場合に skip を返す純粋判定とする
2. `recordingDecision.ts` に `decideL0(enabled)` を追加する。`enabled === false` の場合に skip を返す純粋判定とする
3. `saveToObsidianStep` の 2 つの `if` 分岐を `decideSaveSkip` への委譲に置き換える。step 側には settings からの値読み取りと `deps.obsidian` の有無確認だけを残す
4. `extractSentencesStep` の `l0Enabled` 分岐を `decideL0` への委譲に置き換える。step 側には settings からの値読み取りだけを残す
5. `checkDuplicateStep` の warning-threshold と `truncateContentStep` の size gate には触れない。verdict ではなく logging と size-policy のため対象外とする

## 見積もり

1pt（0.25 週）

## 技術的考慮事項

- `recordingDecision.ts` に chrome 関連 API・logging・storage 書き込みを持ち込まない。純粋判定のみとする
- `checkDomainFilterStep` の `decideDomainFilter` 委譲を前例とし、命名と戻り値の形状を既存の `GateVerdict` 流儀に揃える
- `checkDuplicateStep` の warning-threshold は verdict ではなく logging のため対象外とする
- `truncateContentStep` の size gate は verdict ではなく size-policy のため対象外とする
- PBI 17 と `extractSentencesStep.ts` を共有するため、17 の完了後に着手し競合を避ける

## 実装者向け注記

- `src/background/pipeline/steps/saveToObsidianStep.ts:36-40` — `obsidianEnabled === false` の場合に `skipping save` として早期 return する skip 分岐。`decideSaveSkip` に合流させる対象
- `src/background/pipeline/steps/saveToObsidianStep.ts:43-47` — `deps.obsidian` 不在の場合に `skipping save` として早期 return する skip 分岐。`decideSaveSkip` に合流させる対象
- `src/background/pipeline/steps/extractSentencesStep.ts:31-36` — `l0Enabled` が falsy の場合に早期 return する skip 分岐。`decideL0` に合流させる対象
- `src/background/pipeline/steps/checkDomainFilterStep.ts:24` — verdict を `decideDomainFilter` に委譲済みの同型 gate。今回の委譲の前例とする
- `src/background/pipeline/recordingDecision.ts:35-39` — `decideDomainFilter` の純粋判定の実装。新規 predicate の形状の規範とする
- `src/background/pipeline/steps/checkDuplicateStep.ts:57-64` — warning-threshold のログ出力。verdict ではなく logging のため対象外
- `src/background/pipeline/steps/truncateContentStep.ts:30` — `MAX_RECORD_SIZE` による size gate。verdict ではなく size-policy のため対象外

## Definition of Done

- [x] 全 BDD シナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である
