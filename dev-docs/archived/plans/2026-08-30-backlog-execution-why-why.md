# なぜなぜ分析 — 積み残し全体実行計画への徹底的な疑い

> 対象: `dev-docs/plans/2026-08-30-backlog-execution-plan.md` + `detailed-guide.md`
> 実施日: 2026-08-30
> 手法: 5 Whys × 8つの迷い（=40問）、各迷いの根因→示唆→解→判断を明記
> 結論: **迷いはある。7件は計画の前提を揺るがす。** 下記で全てを言語化し、Go/No-Go と Mitigation を決定する。

---

## 総評 — 迷いはあるか？

**ある。** マスタープランは 3系統の RICE と Wave を統合した点で有用だが、以下の 8つの迷いが残る。放置すると「Wave 1 で e2e が壊れる」「29-12 で既存ユーザーの復号が失敗する」「30-01 で本文保護が後退する」という致命的な手戻りが起きる。

| # | 迷い | 深刻度 | 5 Whys で掘るべき問い |
|---|------|--------|----------------------|
| M1 | Wave 0 の「VulnHunter 再スキャンでアーカイブ判定」は本当に検証になるのか？ | 高 | 再スキャン基盤が存在しないのに DoD を満たせるのか |
| M2 | 29-06 を 4迂回まとめて 1 PBI/1ブランチでやるのは肥大化ではないか？ | 高 | なぜ 4経路を束ねたのか、分割すべきではないか |
| M3 | 29-12 の 600k SSOT 化と KEK session-only 化は既存ユーザーを壊さないか？ | 高 | なぜ 100k と 600k が併存しているのか、移行は安全か |
| M4 | 30-01 Readability 置換は Confidence 0.6 のまま 3日でやるべきか？ | 高 | なぜ 0.6 なのに RICE 4.8 で Wave 2 に入っているのか |
| M5 | 30-04 の jsdom ベンチマークは実ブラウザの判断材料になるのか？ | 中 | なぜ jsdom で測るのか、1パスは本当に速いのか |
| M6 | 30-06 プリセットは 32トグルのユーザ設定を破壊しないか？ | 中 | なぜプリセットが必要なのか、custom の扱いは |
| M7 | 30-02 の `x-` 除去と決定木化は誤爆と取りこぼしのトレードオフを悪化させないか？ | 中 | なぜ `x-` が残っていたのか、決定木は速いのか |
| M8 | Wave 1B の 4並列（30-12/04/06/09）は本当に disjoint か？ | 中 | なぜ並列可能と判断したのか、隠れた触接はないか |

各迷いを 5 Whys で掘り下げる。

---

## M1: Wave 0 の再スキャン検証は本当に機能するのか？

### 5 Whys

1. **なぜ Wave 0 でアーカイブ判定できるのか？** → VulnHunter 再スキャンで VULN が解消したことを確認するから。
2. **なぜ再スキャンが確認になるのか？** → VulnHunter が 48件の再現 PoC（exploit_tests）を持っているから。
3. **なぜ PoC が信頼できるのか？** → しかし `obsidian-smart-history_VULNHUNT_RESULTS_2026-08-29-165536/` は `.gitignore` で除外され、リポジトリにもローカルにも残っていない。PoC の完全な再現入力は復元不可（backlog-audit.md に「復元不可」と明記）。
4. **なぜ復元不可なのに DoD に「VulnHunter 再検証」と書いたのか？** → 当時の攻撃具体は「なぜなぜ分析」節に要約（例: 30ドット→8265ms）しか残っておらず、数値はあるが exploit_tests のコードは失われた。
5. **なぜ失われたのに計画は再スキャンを前提にしたのか？** → 「再スキャンすれば解消確認できる」という楽観が、実際には「再現テストを自前で再構築するコスト」を隠蔽している。

### 根因

**検証基盤の欠如。** 29-04/08/14/19 の DoD「VulnHunter 再スキャンで解消」は、現状の `pbi/` 運用では実行不可能な外部依存になっている。

### 示唆

- スイープで「52ファイル中 20サイトの RMW 形状、うち 16は正当理由付きで緩和済み」と文書化されているように、**真の検証は codebase 内の変異テスト（インターリーブ再現）** である。
- PR #79 の `keySerializer.test.ts`、PR #77 の `computeLimits.test.ts` など、既に lock/cap のテストは存在する。

### 解

- Wave 0 の DoD を「VulnHunter 再スキャン」から「**BDD シナリオの変異テストが RED→GREEN**」に書き換える。
- 新たに `scripts/verify-vulnhunt-fix.mjs` で 5件の BDD 再現テスト（例: buffer `final=['E2']`、リトライキュー `['A','B']→['A']`、log 消失）を集約実行し、結果を `dev-docs/verify-vulnhunt-2026-08-30.md` に残す。
- このスクリプトの green をもってアーカイブ判定とする。再スキャンは任意の外部監査として位置づけを下げる。

### 判断

**Mitigation して Go。** 計画書の Wave 0 DoD を上記に修正する。1日で `verify-vulnhunt-fix.mjs` を作成し、29-04/08/14/19 を即アーカイブ可能にする。

---

## M2: 29-06 は 1 PBI に 4迂回を束ねる肥大化ではないか？

### 5 Whys

1. **なぜ 4迂回を 1 PBI に束ねたのか？** → 根因が共通（trust シームがメッセージ型に限定）で、1回の網羅性テスト拡張で全てを担保できるから。
2. **なぜ共通根因なら 1 PBI が適切なのか？** → しかし 4経路の触接ファイルは完全 disjoint（`loader.ts` / `offlineQueueProcessor.ts` / `readOnlyHandler.ts` / `tabContentFetcher.ts`）で、依存もない。束ねる必然性は「RICE を 1つにまとめる」以外にない。
3. **なぜ disjoint なのに束ねたのか？** → 当初は「4迂回を個別 PBI にすると RICE が分散し優先度が下がる」ことを恐れた。
4. **なぜ優先度が下がることを恐れたのか？** → セキュリティ PBI は数が多いとレビュー負荷が高く、1つにまとめて Wave 3 で一気に片付ける方が楽に見えた。
5. **なぜ楽に見えたのか？** → しかし 1 PBI 2pt の中に「e2e の await 化」「offline の force 解除」「confirm_token のセマンティクス変更」「権限ラダー」の 4つの異なるリスクが混在し、1つでも失敗すると PR 全体が差し戻しになる。

### 根因

**スコープの過剰な凝集。** レビュー容易性を優先して 4つの異なるリスクを 1ブランチに封じ込めたが、実際は「1つがこけると全てがこける」結合度を生んでいる。

### 示唆

- `pbi/2026-08-29-06` の受け入れ基準は 4件の `[ ]` チェックボックスで、既にタスク分解されている。分割しても RICE は 1260 のまま 4分割できる（各 315）。
- `confirm_token` のパーアクション化だけは UX を壊すリスクが高く、他 3件より慎重な E2E が必要。混ぜると E2E の失敗原因が特定できない。

### 解

- **29-06 を 2分割する:**
  - **29-06a `fix/trust-boundary-loader-offline`**（loader + offline、1pt、副作用中）— 並列可能、e2e 互換の確認が主
  - **29-06b `fix/trust-boundary-token-permission`**（confirm_token + 権限ラダー、1pt、副作用高）— UI フロー変更を含むため単独レビュー、E2E で一覧→確認→実行を検証
- または、1ブランチのまま 4コミットに分割し、コミットごとに `git revert` 可能な形にする（計画書の「1ブランチ4コミット」案を厳格化）。

### 判断

**分割して Go。** 計画書の Wave 1A を 06a/06b に分割し、06a を Wave 1、06b を Wave 1.5（06a マージ後）にずらす。レビュー負荷は増えるが、手戻りコストは大幅に下がる。

---

## M3: 29-12 の 600k SSOT と KEK session-only は既存ユーザーを壊さないか？

### 5 Whys

1. **なぜ 600k に統一するのか？** → `primitives.ts:28` の `ENVELOPE_ITERATIONS=600_000` が正で、`PBKDF2_ITERATIONS=100_000` は旧来の弱い値だから。
2. **なぜ 2つの定数が併存しているのか？** → `deriveKey` のデフォルト引数が 100k、`hashPasswordWithPBKDF2` のデフォルトが 600k と、呼び出し元が異なるため。`verifyPasswordWithPBKDF2` は両方を計算して constant-time に比較する互換コードが既に入っている（primitives.ts:350-362）。
3. **なぜ互換コードがあるのに SSOT が必要か？** → 互換コードは「検証時は両方計算」だが、「生成時は呼び出し元が 100k を使うと弱い鍵が生成される」リスクが残る。SSOT で生成側を 600k に統一したい。
4. **なぜ KEK を session-only にするのか？** → `hmacKeyStore.ts:132-138` の `chrome.storage.local` への平文 KEK 保存（VULN-010）が脆弱で、再起動後も `deriveHmacWrappingKey(password, salt)` で復元できるはずだから。
5. **なぜ復元できるはずなのか？** → しかし `deriveHmacWrappingKey` は master password が設定されている前提。master password 未設定のユーザーは KEK を失うと wrapped HMAC 鍵を復号できず、privacy consent の署名検証が恒久的に失敗する。

### 根因

**移行経路の未設計。** 600k 統一は生成側の強化だが、既存 100k 鍵の再ハッシュ戦略と、master password 未設定時の KEK 永続化フォールバックが PBI に明記されていない。

### 示唆

- `verifyPasswordWithPBKDF2` の `needsRehash: true`（legacy 100k で検証成功時）は既に「再ハッシュが必要」シグナルを返している。これを `masterPassword.ts` で検知して 600k で再保存するフローは既存。
- `hmacKeyStore.ts:96-138` の `getOrCreateHmacWrappingKey` は session→local のフォールバックと local への再保存を行う。session-only 化すると、このフォールバックが失われる。

### 解

- **SSOT は段階移行:**
  1. `cryptoParams.ts` に `PBKDF2_ITERATIONS=600_000` を定義しつつ、`LEGACY_PBKDF2_ITERATIONS=100_000` も残す。
  2. 生成時は常に 600k、検証時は `verifyPasswordWithPBKDF2` の既存互換ロジックを維持。
  3. `needsRehash` が true のタイミングでバックグラウンドで 600k に再暗号化（lazy migration）。
- **KEK は条件付き session-only:**
  - master password 設定済み → session-only + `deriveHmacWrappingKey` で復元（VULN-010 解消）
  - 未設定 → local に wrapped 形でのみ保存（平文ではない）。`hmacKeyStore.ts:215-254` の `getOrCreateWrappedHmacKey` は既に wrapped 形で保存しており、KEK 自体を平文で local に置く必要はない。KEK の local 保存をやめても、wrapped 鍵は local に残るので再起動後の検証は可能。
- **HMAC 先行化はバージョンフラグで分岐:**
  - 新規 export は `version:2`（ciphertext HMAC）、旧ファイルは `version:1` として HMAC 検証をスキップする互換読み込み。`CHANGELOG.md` に「旧ファイルは 2026-11-30 まで読み込み可能」と明記。

### 判断

**設計を修正して Go。** PBI 29-12 の受け入れ基準に「未設定時の KEK フォールバック」「needsRehash 時の lazy migration」「旧 export の読み込み互換」を追記する。3pt の見積もりは 4pt に増やすべき（移行テストが増える）。

---

## M4: 30-01 Readability は Confidence 0.6 で 3日投資すべきか？

### 5 Whys

1. **なぜ Confidence 0.6 なのか？** → Body Protection は唯一の削除ガードで、置換で回帰すると要約品質が直接落ちる。Mozilla Readability は日本語・短文での実績が不明。
2. **なぜ日本語で不明なのか？** → Readability.js は英語の記事構造（p/h1-h6/article）で学習され、日本語の `div` 連打や `l-footer`/`p-entry__footer` のような BEM 構造を想定していない。
3. **なぜ BEM を想定していないのか？** → 現行の `readabilityScore.ts` は `positivePatterns=['article','content']` と `negativePatterns=['nav','menu']` の簡易 class 補正しかなく、日本語サイトの `corp-info`/`kanren` などは `patterns.ts` の別ルールで削っている。Readability に置換しても、これらの日本語ルールは別途必要。
4. **なぜ別途必要なのに置換するのか？** → 短文（600字/見出し1つ）で保護失敗する課題は確かにあるが、現行の 200 閾値を 150 に下げるだけでも 8割は解消する可能性がある。
5. **なぜ閾値調整で済む可能性を検証していないのか？** → PBI の「背景」に「閾値200は短文で保護漏れ」とあるが、閾値を 100/150/200 で振った際の保護成功率の実測データがない。Readability 置換の前に、閾値チューニングの PoC が先ではないか。

### 根因

**解決策の早期固定。** 課題は「短文で保護漏れ」だが、解を「Readability に置換」に固定しており、より安価な「閾値調整」「p/h 要素の重み再配分」の検証がスキップされている。

### 示唆

- `calculateReadabilityScore` は `text.length/10 + p*25 + h*50` の線形和。`p*25` を `p*40` に、閾値を 200→120 に下げれば、3段落600字でも `60 + 75 + 50 =185` → 保護される。
- Readability の「親へのスコア伝播」は魅力的だが、移植コストとバンドルサイズ増（数KB）を伴う。`bodyProtection.test.ts` の期待値を全て書き換える必要もある。

### 解

- **30-01 を 2段階に分割:**
  1. **Spike 0.5日:** 現行スコアの閾値・重みを振って短文3パターン（300/600/800字）での保護成功率を計測。`readabilityScore.test.ts` に新ケースを追加し、閾値120で green になるか確認。
  2. **判断:** Spike で 80% 改善なら Readability 置換は見送り、閾値調整のみで完了（0.5日で DoD）。改善しなければ Readability 置換に進む（残り2.5日）。
- PBI の受け入れ基準に「Spike で閾値調整の効果を先に測定し、Readability 置換の要否を判断する」を追加。

### 判断

**Spike を前置して Go。** 計画書の Wave 2 で 30-01 を即着手せず、30-02 の後に 0.5日 Spike を挟む。Confidence 0.6 のまま 3日を賭けるのはリスクが高い。

---

## M5: 30-04 の jsdom ベンチマークは実ブラウザの判断材料になるのか？

### 5 Whys

1. **なぜ jsdom で測るのか？** → `scripts/benchmark-cleansing.mjs` を Node で手軽に実行できるから。
2. **なぜ手軽さで jsdom を選んだのか？** → 実ブラウザ（Playwright）で測るには `npm run test:e2e` の起動コスト（数秒）と `performance.mark` の収集が面倒だから。
3. **なぜ面倒なのか？** → しかし jsdom の `querySelectorAll` は実ブラウザの C++ 実装と全く異なる。jsdom は JS でセレクタを評価するため、74回走査のオーバーヘッドが実ブラウザより大きく出やすい。
4. **なぜ大きく出やすいのに比率で判断するのか？** → PBI に「絶対値ではなく比率で判断」とあるが、jsdom で 6倍差が出ても実ブラウザで 1.2倍なら、1パス集約の価値はない。
5. **なぜ 1パスが価値がない可能性があるのに計測するのか？** → 計測自体が 1日の投資だが、1パス PoC の作成（`singlePass.poc.ts`）も含めると、結局「74回走査を 1回に集約するリファクタ」の 70% を実装することになる。計測のための PoC が本番リファクタと同等のコストなら、計測の意味が薄れる。

### 根因

**計測手法と実装コストの逆転。** ベンチマークのための PoC が本番実装のコストに匹敵し、かつ jsdom の数値が実ブラウザを代表しない。

### 示唆

- 現行の `querySelectorAll` 74回は、デフォルト7ルールONで21回。1000要素DOMでの実測は数ms程度と推定され、Content Script の実行時間（数十ms）に占める割合は小さい。
- `blog-6_5` で「集約はリスクがリターンに見合わない」と判断されたのは、まさにこのコスト感から。

### 解

- **30-04 を軽量化:**
  1. PoC は作らず、現行コードに `performance.mark` を一時追加するだけの計測に留める（0.5日）。
  2. 計測は Playwright の `page.evaluate(() => performance.now())` で実ブラウザの 100/500/1000要素DOMで 3回ずつ実行し、中央値を取る。
  3. 結果が 10ms 未満なら「集約不要」と即決し、`dev-docs/dig-findings-*.md` に記録して PBI をクローズ。10ms 以上なら 30-05 の検討に進む。
- PBI の見積もりを 1pt→0.5pt に縮小し、Wave 1 の 4並列から外して単独の調査タスクとして扱う。

### 判断

**スコープを縮小して Go。** 1パス PoC は作らない。実ブラウザでの `performance.mark` 計測のみで判断する。

---

## M6: 30-06 プリセットは 32トグルのユーザ設定を破壊しないか？

### 5 Whys

1. **なぜプリセットが必要か？** → 32トグルは多すぎてユーザーが設定できない。3-4プリセットに束ねれば UX が向上する。
2. **なぜ 32トグルが多すぎるのか？** → しかし現行の `entrypoints/options/index.html` は既に `AiSummaryCleansingSettingsV2.ts` で `RuleKey` からの mapped type `Record<`${RuleKey}Enabled`, boolean>` に SSOT 化され、32トグルは `CLEANSING_RULES` テーブルから自動生成されている。UI は 32個の checkbox が並ぶが、デフォルトは 7ON/25OFF でユーザーは触らない。
3. **なぜ触らないのにプリセットが必要か？** → 「触らないならプリセットも不要」にも見えるが、実際には `balanced`/`aggressive` の 2段階があれば、ヘビーユーザーが `deepEnabled` を一括でONにできる。
4. **なぜ一括ONがプリセットでなければならないか？** → `deepEnabled` 1つをONにするだけで 15ルールが有効になる。プリセットは「deep を含むかどうか」の 2択に過ぎないなら、32トグルの抽象化は過剰。
5. **なぜ過剰なのに 3日かけるのか？** → プリセット適用時に「ユーザーの custom 設定を上書きしてしまう」リスクがある。`custom` の自動遷移ロジックを誤ると、ユーザーが手動で調整した 32トグルの 1つを変更しただけで `balanced` に戻ってしまう。

### 根因

**抽象化の粒度ミスマッチ。** 32トグルの大半は `deepEnabled` 配下で、実質的な自由度は「minimal/balanced/aggressive」の 3段階に集約される。プリセットは有用だが、32トグルの完全な抽象化は不要。

### 示唆

- `src/utils/aiSummaryCleaner/presets.ts` の `PRESETS` 定義は、実際には `deepEnabled`/`newsEnabled`/`ecEnabled` の 3フラグの組み合わせで表現できる。
- マイグレーション: 既存ユーザーの `chrome.storage.local` には 32トグルの個別値が保存されている。プリセット導入時に「既存設定をどのプリセットにマッピングするか」のロジックがないと、初回起動で `minimal` にリセットされる。

### 解

- **マイグレーションを明記:**
  ```ts
  function migrateToPreset(config: CleansingConfig): PresetId {
    if (config.deepEnabled) return 'aggressive';
    if (config.newsEnabled || config.ecEnabled) return 'balanced';
    return 'minimal';
  }
  // 初回起動時に local の 32値を読み、対応する preset に変換して保存
  // 以降は preset 変更時のみ 32値を上書き、custom は手動変更時にのみ遷移
  ```
- **custom の遷移条件を厳格化:** プリセット適用直後の checkbox 変更は `custom` にしない（初期描画時のイベントを無視）。ユーザーが明示的に 1トグルを変更した時のみ `custom` に遷移。

### 判断

**マイグレーションを追記して Go。** 計画書の 30-06 に上記マイグレーションと custom 遷移の厳格化を追記する。3日の見積もりは妥当だが、テストに「既存設定からのマイグレーション」ケースを必須追加。

---

## M7: 30-02 の `x-` 除去と決定木化はトレードオフを悪化させないか？

### 5 Whys

1. **なぜ `x-` が SOCIAL_CLASS_PATTERNS に残っていたのか？** → `x-` は旧 Twitter の `x.com` 対応で追加されたが、`x-data`/`x-bind`（Alpine.js）や `x-` で始まる任意のクラスにヒットする。
2. **なぜ `x-` が誤爆するのに残っていたのか？** → `isLikelyAd` は `/(^|[-_\s])ad([-_\s]|$)/` の単語境界で対策済みだが、`isLikelySocial` には同等のガードがなく、`x-` は部分一致のままだった。
3. **なぜ `isLikelySocial` にガードがないのか？** → `helpers.ts` の `isLikelySocial` 相当の関数は存在せず、`buildClassIdSelectors(['x-'])` が `[class*="x-"]` に展開され、全ての `x-` クラスを無差別に削除していた。
4. **なぜ無差別削除が放置されたのか？** → Body Protection が `data-ow-body-protected` で誤爆を救済していたため、顕在化しなかった。`address` が `ad-` で消える問題も同様に Body Protection 頼みだった。
5. **なぜ Body Protection 頼みにしたのか？** → 削除判定を「クラス部分一致」で広く取り、保護で救うという設計は、カバレッジ優先だが誤爆の根本解決ではない。決定木化で判定を厳格化すると、今度は「本物の広告が `role=complementary` を持たない場合に取りこぼす」リスクが生じる。

### 根因

**カバレッジと精度のトレードオフの未定量化。** 部分一致は誤爆するが取りこぼしが少なく、決定木は精度が高いが取りこぼしが増える。どちらがユーザー価値に資するかの基準がない。

### 示唆

- `stripCore.test.ts` / `stripExtended.test.ts` には `address-book` の誤爆テストはあるが、「本物の広告が削除される」テストのカバレッジは低い。
- `SOCIAL_CLASS_PATTERNS` の `x-` を単に除去すると、旧 Twitter の `x-share-button` が残る。`x-` の代わりに `x-share`/`x-follow` の具体的なパターンに置換すべき。

### 解

- **30-02 の受け入れ基準を補強:**
  - `x-` は除去せず `x-share`/`x-follow`/`x-button` の 3つに具体化
  - `isLikelySocial` を新設し、単語境界 + `aria-label` + テキスト内容（"Share on X"）の決定木に
  - テストは「誤爆0件」「本物削除」の両方を `test/corpus` の実サイト HTML で検証（30-09 の corpus を活用）
- 性能: TreeWalker 1回 + 決定木判定は `querySelectorAll` 74回より遅くなる可能性もあるため、30-04 のベンチマーク結果を待ってから着手（計画書の 02→01 順は維持しつつ、04 の結果が 1パス不要なら決定木の性能影響は軽微と判断）。

### 判断

**パターンを具体化して Go。** `x-` の除去ではなく具体化、決定木は `isLikelyAd` の成功パターンを横展開する。30-09 の corpus で両方向のテストを担保する。

---

## M8: Wave 1B の 4並列は本当に disjoint か？

### 5 Whys

1. **なぜ 4並列が disjoint と判断したのか？** → 30-12 は `patterns.ts` のみ、30-04 は `scripts/` のみ、30-06 は `presets.ts` + `options/index.html`、30-09 は `test/corpus/` + `scripts/` と、ファイル触接が重ならないから。
2. **なぜ重ならないと判断したのか？** → しかし 30-06 の `aiSummaryCleansingSettingsV2.ts` は `CLEANSING_RULES` を import し、30-12 の `patterns.ts` 変更は `CLEANSING_RULES` の `strip` 関数に影響する。`CLEANSING_RULES` は `rules.ts` で `patterns.ts` の定数を参照している。
3. **なぜ `rules.ts` の依存を見落としたのか？** → `rules.ts` は `stripCore.ts`/`stripExtended.ts` の関数と `patterns.ts` の定数を 1テーブルに束ねる SSOT で、全クレンジング PBI がここで交差する。30-02 も `rules.ts` を触る。
4. **なぜ SSOT で交差するのに並列としたのか？** → 30-12 の多言語パターン追加は `patterns.ts` の定数追加のみで `rules.ts` のテーブル構造は変わらない、と楽観した。
5. **なぜ楽観したのか？** → しかし `rules.ts` のテーブルは型レベルで `RuleKey` を導出しており、`patterns.ts` に新しいパターンを追加すると `RuleKey` の union が変わり、`presets.ts` の `Partial<CleansingConfig>` の型も変わる。型の変更は `aiSummaryCleansingSettingsV2.ts` の `onPresetChange` に波及する。

### 根因

**SSOT による暗黙の結合。** `patterns.ts` → `rules.ts` → `types.ts` → `presets.ts` → `aiSummaryCleansingSettingsV2.ts` の型依存チェーンが、ファイル触接の表面的な disjoint を超えて結合している。

### 示唆

- 並列実行時に 30-12 と 30-06 が同時に `rules.ts` の型を変えると、コンフリクトする。
- 30-09 の `check-cleansing-corpus.mjs` は `cleanseAISummaryContent` を import するため、`patterns.ts` の変更が corpus の期待値（削除数）に影響する。30-12 と 30-09 を並列で走らせると、corpus の baseline が定まらない。

### 解

- **Wave 1B を 2段階に分割:**
  - **1B-1（1日）:** 30-12（i18n）と 30-04（benchmark）のみ並列 — 両者は `rules.ts` の型に影響しない（benchmark は `scripts/` のみ）
  - **1B-2（3日）:** 30-06（presets）と 30-09（corpus 土台）を 1B-1 マージ後に並列 — 30-12 の `patterns.ts` 変更が反映された状態で `rules.ts` の型を確定させてから presets/corpus を作る
- または、30-12 を 1B-1 で先にマージし、30-06/09 は `main` の最新を pull してから着手する運用ルールを明記。

### 判断

**2段階化して Go。** 計画書の Wave 1B 4並列を 1B-1（12+04）と 1B-2（06+09）に分割する。カレンダ日数は 1日増えるが、コンフリクトと baseline 不整合を回避できる。

---

## 追加の迷い（軽微だが記録）

### M9: `dev-docs/plans/` が `.gitignore` で無視される

- `plans/` パターンが `dev-docs/plans/` も無視する。本計画は `git add -f` で強制追加したが、次回 `git status` で untracked として表示されない。運用ルール「`dev-docs/plans/` に一本化」と `.gitignore` が矛盾。
- **解:** `.gitignore` を `plans/` → `/plans/`（ルートのみ）に修正するか、`!dev-docs/plans/` を追加。別 PR で対応。

### M10: RICE 尺度の系統間比較不能

- 29系は `Reach×Impact×Confidence/Effort(人月)`、30系は `Reach(1-10)×Impact(1-10)×Confidence/Effort(日)` と分母が異なる。計画書で「比較しない」と明記したが、Wave 1 で 29-06(RICE1260) と 30-12(RICE12.0) を同時着手する優先度判断は暗黙に「29系を優先」としている。
- **解:** 現状のままで良いが、Wave 1 の Track A/B を「セキュリティは単独レビュー、クレンジングは並列」と役割で分離していることを明記し、RICE 比較ではないことを強調。

---

## 総括 — 計画への反映

| 迷い | 反映内容 | 計画書の修正箇所 |
|------|----------|------------------|
| M1 | DoD を「再スキャン」→「変異テスト green」に変更、`verify-vulnhunt-fix.mjs` 新設 | Wave 0 |
| M2 | 29-06 を 06a/06b に分割、06b を Wave 1.5 に | Wave 1A |
| M3 | 29-12 に lazy migration と条件付き session-only、旧 export 互換を追記、見積もり 3pt→4pt | Wave 2.5 |
| M4 | 30-01 に 0.5日 Spike を前置、閾値調整で済むか先に判断 | Wave 2 |
| M5 | 30-04 は PoC なし、実ブラウザの `performance.mark` のみに縮小、0.5pt に | Wave 1B-1 |
| M6 | 30-06 にマイグレーションと custom 遷移の厳格化を追記 | Wave 1B-2 |
| M7 | `x-` は具体化（`x-share` 等3つ）に、決定木は両方向テストを corpus で担保 | Wave 2 |
| M8 | Wave 1B 4並列を 1B-1(12+04)/1B-2(06+09) に分割 | Wave 1 |
| M9 | `.gitignore` 修正を別 PR で | 運用 |
| M10 | RICE 非比較の明記は維持 | 記載維持 |

**結論:** 迷いは 8件あったが、全てに Mitigation が存在する。**計画は修正して Go。** 上記反映後の計画で Wave 0 から着手可能。

