# PBI: プリセットプロンプトのロケール対応方針の確定

種別: investigate

## ユーザーストーリー

英語ロケールのユーザーとして、プリセットを選ぶたびに日本語のプロンプトが AI へ送られるのかどうかを把握したい。プリセット本文を UI locale に従わせるのか、feature 固有言語として固定するのか、English プリセットを英語固定するのかを裁定し、既存の保存済みスナップショットを壊さない移行方針まで定義してほしい。

## ビジネス価値

- 英語ロケールの利用者が、プリセット選択時に意図しない日本語指示を受け取ることを防ぐ製品規格を定める。
- プリセットの言語仕様を明示し、UI のロケールと feature の出力言語を混同しない。
- 保存済みスナップショット、複製済みプロンプト、暗号化バックアップを壊さない移行判断基準を作る。
- 裁定結果を後続の `feat` または `refactor` PBI に引き継ぐ。

## 優先度

順位: 10 / 30
RICEスコア: 1.67（Reach=5 / Impact=1 / Confidence=50% / Effort=1.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 5つのプリセットの言語仕様を裁定する
  Given PRESET_PROMPTS に Default、Tagged、Bullet、English、Technical の5件が定義されている
  And 通常の Default は getDefaultUserPrompt(effectiveLocale) と getDefaultSystemPrompt(effectiveLocale) を使う
  When 各プリセットの本文、プリセット名、Built-in AI の expectedOutputs と system prompt の言語関係を調査する
  Then UI locale に従う方針、Tagged・Bullet・Technical を feature 固有言語として固定する方針、English プリセットを英語固定する方針の採否を明記する
  And 各プリセットについて本文の言語、AI へ送る指示の言語、期待する要約言語の関係を明記する

Scenario: 保存済みプリセットの移行方針を決める
  Given 旧バージョンで有効化されたプリセットが custom_prompts に id="__preset__<id>" として保存されている
  And 現行の PRESET_PROMPTS は同じプリセット ID でも本文を変更している可能性がある
  When 現在の active resolution、保存時の upsert、AI 反映経路を確認する
  Then 保存済みスナップショットを stable preset ID として実行時に resolve するか、旧スナップショットを保持するか、自動置換するかを手順付きで裁定する
  And 旧 custom_prompts、settings バックアップ、暗号化 combined バックアップを壊さない条件を確認する

Scenario: 複製済みプロンプトをユーザー所有として扱う
  Given プリセットの複製で ID が prompt_<timestamp> に変わり、locale、version、由来プリセットのフィールドが保存されない
  When 複製済み prompt を移行対象として分類する
  Then 通常のユーザー custom prompt として保持し、プリセット由来と機械的に判定しない
  And __preset__* の自動置換や再関連付けを、ユーザーが明示的に新しい操作を選んだ場合以外には行わない

Scenario: 責務境界とロケール契約を保つ
  Given プリセット定義と active resolution は customPromptUtils の責務である
  And dashboard の DOM、event、persistence は customPromptManager の責務である
  When 裁定した仕様を後続実装の受け入れ条件へ変換する
  Then 本文のロケール分岐を customPromptManager へ持ち込まない
  And 機械向け本文には locale 引数を明示し、ブラウザ locale の暗黙参照に依存させない
```

## 受け入れ基準

- [ ] Default、Tagged、Bullet、English、Technical の5件について、現在の本文と表示名の locale 依存関係を整理している。
- [ ] 通常の Default が `getDefaultUserPrompt(effectiveLocale)` と `getDefaultSystemPrompt(effectiveLocale)` を使い、他のプリセット本文がソース埋め込みである事実を裁定材料として記録している。
- [ ] UI locale に従う、Tagged・Bullet・Technical を feature 固有言語として固定する、English プリセットを英語固定する、という候補を個別の採用・不採用と根拠付きで決定している。
- [ ] プリセット名と `getPromptDisplayName()` の locale 分岐を、本文の locale 仕様と同一視せず、表示責務と本文責務を分けて記録している。
- [ ] `__preset__*` の保存済み `userPrompt` と `systemPrompt` が fallback より優先される現行挙動を確認し、stable preset ID による実行時 resolve、保持、自動置換の候補を比較している。
- [ ] 旧 `__preset__*` を自動置換する場合としない場合の互換性条件、ユーザーが既存内容を保持する手順、復元後に同じ選択が再現される条件が明記されている。
- [ ] `__preset__*` の自動置換でユーザーのカスタマイズ意図を壊さないことが、移行方針に明記されている。
- [ ] 複製で ID が `prompt_<timestamp>` になる prompt は、由来プリセットを判別できないためユーザー所有スナップショットとして保持する方針が明記されている。
- [ ] `custom_prompts` が暗号化バックアップの復元対象に含まれること、旧 `custom_prompts`、通常の settings バックアップ、暗号化 combined バックアップを壊さない移行条件が明記されている。
- [ ] 本番 AI 反映箇所が `ProviderStrategy` と `BuiltInAiProvider` の2箇所であり、Built-in AI の `expectedOutputs` と system prompt も日本語固定である事実を踏まえている。
- [ ] プリセット定義と active resolution は `customPromptUtils` に置き、dashboard の DOM、event、persistence は `customPromptManager` に置く責務境界を維持している。
- [ ] 機械向け本文は locale 引数を明示し、ブラウザ locale の暗黙参照に依存しない契約が後続 PBI に渡されている。
- [ ] en/ja parity を維持し、`_locales` を変更する場合は `pbi/2026-09-25-09-fix-popup-untranslated-title-token.md` との共有編集競合を調査対象として明記している。
- [ ] 本 PBI は調査と仕様確定に限定し、裁定後の実装は `feat` または `refactor` の別 PBI に分割している。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI ではプロダクションコードを変更せず、既存挙動を変更する E2E テストは追加しない。
- 後続実装 PBI では、英語ロケールと日本語ロケールで各プリセットを有効化し、送信される `userPrompt` と `systemPrompt`、要約の言語を確認する Outside-In シナリオを定義する。
- 後続実装 PBI では、旧 `__preset__*` の保存済みスナップショット、複製済み `prompt_<timestamp>`、暗号化バックアップ復元後の各ケースを E2E 契約として確認する。
- Built-in AI を使う場合は、本文だけでなく `expectedOutputs` と system prompt を含めて出力が日本語固定のままでないことを確認する。

### 統合テスト

- `src/utils/__tests__/customPromptUtils.test.ts:231-243,247-300,328-355` を利用し、5プリセット、locale behavior、プリセット名の分岐を契約として整理する。
- `src/dashboard/settings/__tests__/customPromptManager.test.ts:550-657` を利用し、`__preset__*` の upsert、Default 複製、プリセット複製が保存する ID と本文を確認する。
- `scripts/__tests__/localeParity.test.ts` を利用し、en/ja の parity を確認する。
- 旧 `custom_prompts`、通常の settings バックアップ、暗号化 combined バックアップの復元経路について、移行判断後も同じデータを読み出せる契約を後続 PBI の統合テストへ含める。
- `ProviderStrategy` と `BuiltInAiProvider` の2つの AI 反映経路が、裁定した解決結果を同じ形で利用できることを統合確認する。
- 複製済み prompt が `__preset__*` の自動置換に巻き込まれないことを、manager の保存経路と復元経路の両方で確認する。

### 単体テスト

- `PRESET_PROMPTS` の5件、locale を受け取る本文解決関数、feature 固有言語として固定するプリセットの契約を個別に確認する。
- `getPromptDisplayName()` の `name` / `nameJa` 分岐と、本文の locale 分岐が独立していることを確認する。
- `getDefaultUserPrompt(effectiveLocale)` と `getDefaultSystemPrompt(effectiveLocale)` の既存 Default 挙動を固定する。
- 旧 `__preset__*` の stable ID 解決、保存済み表現の保持、自動置換の候補を1つの裁定へ固定する。
- 複製済み `prompt_<timestamp>` に由来フィールドがないため、ユーザー所有スナップショットとして保持する分類を確認する。
- 機械向け本文の関数が locale を明示して呼ばれ、ブラウザ locale を暗黙に参照しないことを確認する。
- Built-in AI の日本語固定の `expectedOutputs` と system prompt を、本文変更の影響範囲として確認する。

## 実装アプローチ

1. 調査対象の事実を固定する。5件のプリセット、既存 locale 関数、保存経路、active resolution、2つの AI 反映箇所、バックアップ復元対象、既存テストを一覧化する。
2. 各プリセットについて、表示名、本文、user prompt、system prompt、期待する出力を別列として言語仕様表を作成する。
3. 5 Whys を順に実施し、locale 未解決、保存済みスナップショットの優先、定義参照でない保存、複製済み prompt の由来不可視という根本原因を製品判断につなげる。
4. UI locale に従う案、Tagged・Bullet・Technical を feature 固有言語として固定する案、English プリセットを英語固定する案を比較する。各案について feature identity、en/ja parity、Built-in AI の出力契約を評価する。
5. 旧 `__preset__*` を stable preset ID として実行時 resolve する案、保存済みスナップショットを維持する案、自動置換する案を比較する。複製済み ID はユーザー所有として分離する。
6. 旧 `custom_prompts`、通常の settings バックアップ、暗号化 combined バックアップを壊さない移行手順と、復元後に選択が再現される条件を書き出す。
7. 裁定結果を、責務境界、locale 明示、en/ja parity、バックアップ互換性を含む後続 PBI の受け入れ基準へ変換する。
8. 本 PBI では実装を行わず、裁定された変更が `feat` か `refactor` かを明示した実装 PBI を別 PBI として準備する。

## 見積もり

1.5 SP（調査と仕様確定まで。確定後の実装は別 PBI になる想定）

## 技術的考慮事項

- プリセット定義は `src/utils/customPromptUtils.ts:123-166` の5件を対象とする。Tagged、Bullet、Technical の本文は日本語固定、English の本文は英語固定である。
- `name` と `nameJa`、`getPromptDisplayName()` の locale 分岐は `src/utils/customPromptUtils.ts:184-191` にあるが、`_locales` のメッセージキー経由ではない。
- 通常の Default は `src/utils/customPromptUtils.ts:306-341` の locale 引数付き関数を使う。Default オブジェクト内のコピーも日本語である。
- 有効化時の保存は `src/dashboard/settings/customPromptManager.ts:405-462` と `src/utils/customPromptUtils.ts:270-325` を通る。保存済み `__preset__*` は現行定義で自動上書きされない。
- Default の複製は非推奨の日本語別名 `DEFAULT_USER_PROMPT_JA` と `DEFAULT_SYSTEM_PROMPT_JA` を読む経路が `src/dashboard/settings/customPromptManager.ts:465-480` と `src/utils/customPromptUtils.ts:102-107` にある。
- 複製後の ID は `prompt_<timestamp>` となり、元のプリセットとの結び付きを失う。保存型は `src/utils/types.ts:64-77` の `{id, name, provider, systemPrompt, prompt, isActive, createdAt, updatedAt}` で、locale、version、由来プリセットのフィールドはない。
- `custom_prompts` は `src/utils/storage/restorableSettings.ts:159-164` により暗号化バックアップの復元対象に含まれる。通常の settings バックアップと暗号化 combined バックアップも移行対象として維持する。
- 本番 AI 反映箇所は `src/background/ai/providers/ProviderStrategy.ts:276-280` と `src/background/ai/providers/BuiltInAiProvider.ts:59-70` の2箇所である。
- `src/background/builtInAIClient.ts:71-81` の `expectedOutputs` と system prompt は日本語固定である。本文だけを英訳しても出力が日本語のままになり得る。
- プリセット定義と active resolution は `customPromptUtils`、dashboard の DOM、event、persistence は `customPromptManager` の責務境界を維持する。manager に本文の分岐ロジックを持ち込まない。
- 機械向け本文には locale 引数を明示し、ブラウザ locale の暗黙参照に依存しない。
- en/ja parity を維持する。`_locales` を触る場合は `pbi/2026-09-25-09-fix-popup-untranslated-title-token.md` との編集競合を確認する。
- 旧 `__preset__*` の自動置換は、ユーザーのカスタマイズ意図を壊す可能性があるため、採否と移行条件を利用者に説明可能な形で定義する。
- 依存関係はない。実装上の依存はなく、`_locales` の共有による編集競合のみ考慮する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/customPromptUtils.ts:123-166` に Default、Tagged、Bullet、English、Technical の5プリセットがある。
- `src/utils/customPromptUtils.ts:184-191` の `getPromptDisplayName()` は `name` と `nameJa` を locale で分岐するが、メッセージキーを使うではない。
- `src/utils/customPromptUtils.ts:306-341` の通常の Default は `effectiveLocale` を明示的に受け取る。
- Tagged、Bullet、Technical の本文は日本語固定、English の本文は英語固定である。Default オブジェクト内のコピーも日本語である。
- `src/dashboard/settings/customPromptManager.ts:405-462` と `src/utils/customPromptUtils.ts:270-325` に有効化時の保存経路がある。
- Default の複製経路は `src/dashboard/settings/customPromptManager.ts:465-480` と `src/utils/customPromptUtils.ts:102-107` の `DEFAULT_USER_PROMPT_JA` / `DEFAULT_SYSTEM_PROMPT_JA` を読む。
- `src/dashboard/settings/customPromptManager.ts:499-528` では複製 ID が `prompt_<timestamp>` になり、由来プリセットの結び付きが失われる。
- `src/utils/types.ts:64-77` の保存値に locale、version、由来プリセットのフィールドはない。
- `src/utils/storage/restorableSettings.ts:159-164` で `custom_prompts` は暗号化バックアップの復元対象に含まれる。
- `src/background/ai/providers/ProviderStrategy.ts:276-280` と `src/background/ai/providers/BuiltInAiProvider.ts:59-70` の2箇所が本番 AI へ反映する。
- `src/background/builtInAIClient.ts:71-81` の `expectedOutputs` と system prompt は日本語固定である。
- 既存テストは `src/utils/__tests__/customPromptUtils.test.ts:231-243,247-300,328-355`、`src/dashboard/settings/__tests__/customPromptManager.test.ts:550-657`、`scripts/__tests__/localeParity.test.ts` にある。

### 実装手順

1. 上記の現状コードと既存テストを調査台帳に整理し、5プリセットを同じ比較表に並べる。
2. 各プリセットについて、UI locale、feature 固有言語、English 固定の3候補を採否付きで記録する。
3. 5 Whys の各問いに、確認済みの事実、判断材料、残存リスクを対応づける。
4. `__preset__*` の保存値と現行 `PRESET_PROMPTS` の関係を整理し、stable ID 実行時 resolve、保存済み表現の保持、自動置換の採否を1つに決める。
5. 複製済み `prompt_<timestamp>` は由来を判別できないため、ユーザー所有スナップショットとして保持する条件を確認する。
6. 旧 `custom_prompts`、通常の settings バックアップ、暗号化 combined バックアップの復元と移行手順を確認する。
7. `customPromptUtils` と `customPromptManager` の責務境界、locale 明示、en/ja parity、`_locales` の共有競合を裁定に含める。
8. 採用した仕様を後続 `feat` または `refactor` PBI の受け入れ基準とテスト戦略へ落とし込む。

### 落とし穴

- ユーザーが「プリセットは日本語出力が feature」と意図している可能性がある。locale で本文を切り替えると feature identity を変えることになる。
- `accept` 時に旧 `__preset__*` を自動置換すると、ユーザーのカスタマイズ意図を壊す。保存済みスナップショットと stable ID を同一視しない。
- Default の locale 対応だけでは active preset の保存済み prompt が直らない。保存済み prompt が fallback より優先されるため、fallback の関数だけを直しても旧 snapshot は変わらない。
- 複製済み prompt は ID と保存型だけで由来を判別できない。ID だけを根拠に `__preset__*` へ移行しない。
- `name` / `nameJa` の locale 分岐と、本文の言語固定は別の責務である。表示名が locale 対応であることを本文対応と説明しない。
- 本文だけを英訳しても、Built-in AI の `expectedOutputs` と system prompt が日本語固定なら出力が日本語のままであり得る。
- `_locales` への変更は `pbi/2026-09-25-09-fix-popup-untranslated-title-token.md` と競合し得る。en/ja parity と編集順を確認する。
- `customPromptManager` に本文分岐を持ち込むと、プリセット定義と active resolution の責務境界が崩れる。
- locale を明示しない機械向け本文は、ブラウザ locale の暗黙参照に依存し、テスト再現性や en/ja parity を損なう。

## 決定事項

5 Whys を使って次を裁定する。

1. なぜ en で日本語が送られるのか。プリセット本文が locale 解決されていないためであることを、定義と保存経路から確認する。
2. なぜ Default の locale 対応が直らないのか。active preset の保存済み prompt が fallback より優先されるためであることを確認する。
3. なぜ更新後に自動修復されないのか。`__preset__*` は定義参照ではなく保存済みスナップショットであることを確認する。
4. なぜ全データを機械移行できないのか。複製済み prompt は通常のユーザー custom と同一構造・別 ID で、由来を判別できないためであることを確認する。
5. 最適仕様は何か。UI locale に従う、Tagged・Bullet・Technical は feature 固有言語、English Summary は英語固定、の候補をどう組み合わせるか裁定する。また、旧 `__preset__*` を保存済み表現ではなく stable preset ID として実行時 resolve するか、複製済み ID はユーザー所有スナップショットとして保持するかを決定する。

裁定成果物には、5 Whys の根拠、5プリセットの言語表、候補の採否、旧 `__preset__*` と複製済み ID の分類、バックアップ互換性、責務境界、後続 PBI の `feat` または `refactor` 分割を必ず含める。

## Definition of Done

- [ ] 5プリセットの本文、表示名、user prompt、system prompt、期待出力の言語関係を調査成果物に整理している。
- [ ] 5 Whys の全問に、確認済みの事実、根拠、裁定、残存リスクが対応づけられている。
- [ ] UI locale 依存、feature 固有言語、English 固定の候補がプリセットごとに採用・不採用として決定されている。
- [ ] 旧 `__preset__*` の移行方針が、stable ID 実行時 resolve、保存済み表現の保持、自動置換の採否として明記されている。
- [ ] 複製済み `prompt_<timestamp>` はユーザー所有スナップショットとして保持する扱いが明記されている。
- [ ] 旧 `custom_prompts`、通常の settings バックアップ、暗号化 combined バックアップの非破壊条件が明記されている。
- [ ] Built-in AI の日本語固定 `expectedOutputs` と system prompt を含めた出力契約が確認されている。
- [ ] `customPromptUtils` と `customPromptManager` の責務境界、locale 明示、en/ja parity、`_locales` の共有競合が受け入れ基準に含まれている。
- [ ] 実装は別 PBI に分離され、種別が `feat` または `refactor` で明示されている。
- [ ] 本 PBI ではプロダクションコードを変更していない。
