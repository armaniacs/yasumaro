---
name: arch-delivery-loop
description: Architecture-to-delivery closed loop — diagnose deepening opportunities, prioritize with RICE, create PBIs, implement them autonomously in RICE-descending order (5 Whys, no confirmation), verify with `make clean test` until green, then bump the version. Use whenever the user wants the full improve-codebase-architecture → PBI → implementation → verification pipeline in one run without stopping, or says "アーキテクチャから実装まで一気に", "architecture loop", "deepening loop", "アーキテクチャ改善を一括で", "コードベース全体を診断して実装まで", "診断から検証まで閉じて", "全部やって", "積み残しを閉じて". Also use when multiple PBIs already exist and the user wants them prioritized and implemented to green without waiting for confirmation, or when an improve-codebase-architecture HTML report was just reviewed and the user says "全部やって".
---

# Arch Delivery Loop — アーキテクチャ診断から検証まで一気に閉じるスキル

直近の実践（2026-08-23）で確立した **「診断 → PBI化 → 自律実装 → make clean test → バージョン更新」** の一連の流れを、途中で止めずに閉じるところまで自律的に回すオーケストレータースキル。

単独の `improve-codebase-architecture`（診断だけ）、`pbi-backlog-prioritizer`（PBI化だけ）、`autonomous-task-closer`（実装だけ）を個別に呼ぶのではなく、**それらを依存順に連結して、最後に `make clean test` が通るまでを1トランザクションとして扱う**。

## いつ使うか

- ユーザーが「アーキテクチャから実装まで一気に」「コードベース全体を診断して直して」と依頼したとき
- `improve-codebase-architecture` の HTML レポートを見た後に「全部やって」と言われたとき
- ユーザーが明示的に `arch-delivery-loop` / `architecture loop` / `deepening loop` と言ったとき
- PBI が複数できていて「優先度付けから実装・検証まで自律的に」と求められたとき
- 「積み残しはあるか？あるなら閉じて」と、未完了の洗い出しから検証までを求められたとき

## 基本原則

- **RICE 降順で実装する。** Phase 1 で RICE スコア降順にソートした順序が、そのまま Phase 2 の実行順になる。
- **依存はスコアより優先。** B が A の完了を前提とするなら、B の RICE が高くても A を先に実装する（例: `ServiceContainer 移行` は `extractor 分割` の完了後に着手）。依存のない候補は並行可能だが、実装は1件ずつ直列で進める。
- **確認不要。** フェーズ間・PBI 間でユーザー確認を挟まず、5 Whys が行動可能な解に達したら即実装する。

## 全体フロー

```
Phase 0: 診断  — codebase-design 語彙で深い/浅いモジュールを判定、HTML レポート生成
Phase 1: PBI化 — RICE スコアリングで優先度付け、pbi/YYYY-MM-DD-NN-type-slug.md を連番出力
Phase 2: 実装  — RICE 降順（依存を尊重）で1件ずつ 5 Whys → 自律実装 → アーカイブ
Phase 3: 検証  — make clean test を実行し、失敗が0になるまで修正を繰り返す
Phase 3.5: グラフ更新 — `graphify update .` でナレッジグラフを最新化
Phase 4: 版上げ — package.json / docs/version.json / CHANGELOG.md を更新しコミット
```

各フェーズは **前段の出力を次段の入力として機械的に渡す**。人手の判断を挟まない。

---

## Phase 0: 診断 — improve-codebase-architecture

`codebase-design` スキルの語彙（module / interface / depth / seam / adapter / leverage / locality / deletion test）を厳密に使い、アーキテクチャ上の摩擦を抽出する。

> **依存の扱い**: `improve-codebase-architecture` は `disable-model-invocation: true` のため自動呼び出しされない。このスキルから明示的に `read` して手順を取り込み、その語彙と HTML レポート形式を守る。`codebase-design` も同様に明示的に読み、module/depth/seam 等の定義を借りる。

### 手順

1. `dev-docs/DESIGN_SPECIFICATIONS.md`（アーキテクチャ設計）と `dev-docs/LAYERS.md`（レイヤー構造）、`dev-docs/ADR/`（設計上の意思決定）を先に読む。`CONTEXT.md` や `docs/adr/` は存在しない前提のプロジェクトであり、ドメイン語彙と制約は上記 `dev-docs/` 配下が唯一の情報源
2. `git log --oneline` の直近 30〜50 件からホットスポット（頻繁に変更される領域）を特定。ユーザーが方向を明示した場合はそちらを優先
3. サブエージェントを spawn し、コードベースを探索:
   - 1つの概念理解に複数モジュールを跨ぐ箇所
   - 浅いモジュール（interface が implementation と同等の複雑さ）
   - テスト容易性のために抽出された純粋関数だが、実際のバグは呼び出し側に潜む箇所（locality 欠如）
   - seam を跨いで漏洩している密結合
   - deletion test で「消しても複雑さが N 箇所に再出現するか」を判定
4. 各候補を HTML レポートとして出力:
   - 出力先: `$TMPDIR/architecture-review-<timestamp>.html`（`$TMPDIR` がなければ `/tmp`、Windows は `%TEMP%`）
   - スタイル: Tailwind CDN + Mermaid CDN、手作り CSS/SVG と Mermaid を使い分け、各候補に before/after 図を付与
   - カード項目: Files / Problem / Solution / Benefits（leverage/locality で記述）/ Before-After 図 / Recommendation strength（Strong / Worth exploring / Speculative）
   - 末尾に Top recommendation（最初に着手すべき候補と理由）
   - `open` / `xdg-open` / `start` で自動オープンし、絶対パスを伝える

### 出力

HTML レポートと、候補リスト（番号付き）。このリストが Phase 1 の入力になる。

---

## Phase 1: PBI化 — pbi-backlog-prioritizer + pbi-create-bdd

Phase 0 の候補（またはユーザーが列挙した複数要求）を、1件ずつ PBI に変換し、**同じ基準（RICE）で優先度付け**してからファイル出力する。

### 手順

1. **列挙**: 候補を独立した番号付きリストで抽出。重複とみられる場合のみ「統合の提案」を確認する
2. **理解**: 各候補の「何を作るか / 誰のため / なぜ必要 / 制約」を、提示文から読み取れるものは復唱で省略し、不足分のみを一覧で1回確認。推測不能な項目は「疑問」として記録
3. **RICE スコアリング**:
   ```
   RICE = (Reach × Impact × Confidence) / Effort
   Reach: 影響するコールサイト/トランザクション数
   Impact: 3=圧倒的 / 2=大 / 1=中 / 0.5=小 / 0.25=極小
   Confidence: 100% / 80% / 50%
   Effort: 人週
   ```
   - 全候補を1つの表にまとめ、**RICE 降順にソート**。この順序が Phase 2 の実行順になる
   - 依存関係はスコアより優先（BがAに依存するならAを先に）。依存のない候補は並行可能と明記しつつ、実装は直列で行う
   - 同点は「リスク軽減 → 緊急性」の順
4. **なぜなぜ分析**: フェーズ2で「Impact が推定できない」「ビジネス価値が書けない」等の疑問が生じたら、その場で 5 Whys を実行（上限20回、根本原因が見えたら停止）
5. **PBI 作成**: `pbi-create-bdd` のテンプレートに準拠し、各 PBI に優先度情報（順位 / RICEスコア / 根拠）を必ず含める。BDD シナリオは最低2本（ハッピーパス + エラー/境界ケース）
6. **ファイル出力**（命名規則は `pbi/00-INDEX.md` の運用ルールに従う）:
   - 個別 PBI: `pbi/YYYY-MM-DD-NN-type-slug.md`（NN=優先順位の2桁連番。`type` は `feat` / `fix` / `refactor` / `doc` / `test` / `investigate` のいずれか。ファイル名の種別が機能追加/非機能追加の判定基準になる）
   - バックログまとめ: `pbi/YYYY-MM-DD-00-backlog[-<suffix>].md`（RICE スコア表 + 依存グラフ + 5 Whys サマリー。suffix はラウンド識別用で、例: `0823a`）
   - `pbi/00-INDEX.md` の「進行中」表に行を追加
   - `pbi/` がなければ作成

### 出力

`pbi/*.md`（未完了のみを置く運用）。このファイル群が Phase 2 の入力になる。

---

## Phase 2: 実装 — autonomous-task-closer

`pbi/*.md` / `dev-docs/plans/*.md` / `TODO` / `チェックボックス` / `検証失敗` / `バージョン不一致` を機械的に洗い出し、**Phase 1 で決めた RICE 降順（依存を尊重）に1件ずつ 5 Whys → 自律実装 → 検証** を、未完了が0になるまで繰り返す。

> **確認不要**: 各 PBI の着手前にユーザーへ確認しない。5 Whys が「その解で行動に移れる」状態に達したら即実装し、次の PBI へ進む。立ち止まるのは「推測不能な根本原因で、かつ分析でも解けない」場合のみ。

### 洗い出し（推測ではなく実行結果で判定）

```bash
ls pbi/*.md | grep -v "00-INDEX"          # PBI 残存
ls dev-docs/plans/*.md | grep -v "00-index" # Plan 残存
grep -rn "TODO\|FIXME" src/ --include="*.ts" | grep -v "__tests__"
grep -rn "^- \[ \]" pbi/ dev-docs/plans/ --include="*.md"
npm run type-check; npm run lint; npm test; npm run build
# package.json / wxt.config.ts / docs/version.json / package-lock.json のバージョン比較
```

### 5 Whys（1件ずつ、一時ファイルに記録）

```
# なぜなぜ分析 — <slug>
## 現象
<ファイルパス + 行数 + 内容>
## 5 Whys
1. なぜ <現象> なのか → <回答>
...
→ 解: <何を・どこに・どの順で実装するか>
```

- 5回に満たなくても行動可能な解に達すれば停止。上限20回
- 表面的な要望の裏の本当のニーズを明らかにする（例: `StorageKeys` 直参照の裏は `vi.mock` 差し替え先の修正）

### 自律解決（確認待ちをしない）

- **PBI**: 受け入れ基準と DoD のチェックボックスを `[x]` に更新 → テスト検証 → `git mv pbi/<file> dev-docs/archived/pbi/` → `pbi/00-INDEX.md` の「進行中」から削除し「アーカイブ履歴」に追記
- **Plan**: `dev-docs/plans/` の `Task 1,2,...` を `Read → Edit → Write` で順に実行、タスクごとに `type-check`。完了したら `git mv dev-docs/plans/<file> dev-docs/archived/plans/`。`plans/`（ルート直下）は廃止済みなので使わない
- **TODO/FIXME**: 実装するか、不要なら削除し `WHY` コメントを残す
- **検証失敗**: その失敗自体を新たな未完了1件として 5 Whys の対象にする

### 出力

`pbi/` が空（`00-INDEX.md` 除く）、`type-check` / `lint` / `test` が個別に PASS。この状態で Phase 3 へ。

---

## Phase 3: 検証 — make clean test が通るまで繰り返す

`make clean test` は `validate:json → lint → type-check → test → build → test:e2e` を一括で走らせる。このコマンドが **exit 0 になるまで**、失敗を1件ずつ潰すループを回す。

### ループ

```
loop:
  make clean test 2>&1 | tail -100
  if exit 0 → break
  else:
    失敗を分類:
    - バージョン不一致 → 保持ファイルをすべて同期（下記）
    - フレイキーなタイミングテスト → 閾値緩和 + コメントで根拠明記
    - type-check / lint → 該当箇所を修正
    - その他テスト失敗 → 5 Whys で根本原因を特定し修正
    goto loop
```

### 一般的な失敗パターンと対処

具体値（バージョン番号・閾値）はプロジェクトごと・セッションごとに異なるため、その場で読み替える。重要なのは「**skip で逃げず、根本原因か閾値の根拠を直す**」こと。

| 失敗の型 | 根本原因 | 対処 |
|------|------|------|
| バージョン不一致（例: `versionConsistency: expected '6.7.66' to be '6.7.67'`） | `package.json` を手で編集したが、他の保持ファイル（`package-lock.json` の `version` と `packages[""].version` の2箇所、`docs/version.json` 等）が追従していない | 保持ファイルをすべて同期。`scripts/sync-version.mjs` や `scripts/check-version-consistency.js` があれば使う。なければ sed で各所を一致させる |
| フレイキーなタイミングテスト（例: `constantTimeCompare: expected 31 to be less than 10`） | タイミング計測が環境高負荷でノイズに沈み、理論比と実測値が乖離する | 閾値を「理論値 + ノイズマージン」に緩和し、コメントで根拠（理論比・ノイズ要因）を明記。`test.skip` は使わない |
| type-check / lint 失敗 | 実装上の欠陥 | 該当箇所を修正 |

### 禁止事項

- `make clean test` の失敗を放置して Phase 4 に進まない
- テストを `skip` して通すのではなく、閾値や実装を正す

---

## Phase 3.5: ナレッジグラフ更新 — graphify update .

Phase 3 でコード変更が確定したら、必ずナレッジグラフを最新化してから版上げに進む。これにより、次回の `graphify query` や `graphify path` が変更後の構造を反映する。

### 手順

```bash
graphify update .
```

- AST のみを使った更新で、API コストは発生しない
- `graphify-out/graph.json` 等が更新される
- `graphify-out/` は通常 `.gitignore` に含まれているためコミット対象としない。更新は Phase 4 版上げの直前に必ず実行する

### 出力

`graphify-out/` 配下が変更後のコード構造を反映した状態。これを前提として Phase 4 に進む。

---

## Phase 4: 版上げ — バージョン同期と CHANGELOG

`make clean test` が通った後に、バージョンを上げる。

### 手順

```bash
# 1. ナレッジグラフ更新（Phase 3.5 で未実行の場合はここで必ず実施）
graphify update .

# 2. 版上げ（例: 6.7.66 → 6.7.67）
# package.json の version を編集
node scripts/sync-version.mjs          # docs/version.json を同期
# wxt.config.ts は package.json から読むため自動追従
# package-lock.json の version と packages[""].version の2箇所を同期（scripts がなければ sed）

# 3. CHANGELOG.md
# [Unreleased] の内容を [<new-version>] - YYYY-MM-DD に昇格し、新しい [Unreleased] を空で用意
# Refactor/Fixed/Changed を Conventional Commits に沿って記載

# 4. 検証
node scripts/check-version-consistency.js  # 4ファイルの一致を確認

# 5. コミット
git add package.json docs/version.json CHANGELOG.md package-lock.json
git commit -m "chore: バージョンを<new-version>に更新"
```

### CHANGELOG 記載ルール

- `v6.偶数.x` は bug fix のみ、`v6.奇数.x` は新機能（プロジェクトのバージョニングポリシー）
- Architecture Deepening の Refactor は1行で7件を要約する形でもよいが、各 PBI の本質（例: `instanceof` 解消、PII境界集約）が伝わる粒度にする

---

## 横断ルール

- **RICE 降順・確認不要**: Phase 1 の実行順を Phase 2 が機械的に消化。PBI 間でユーザー確認を挟まない
- **TodoWrite 徹底**: フェーズごとに `in_progress` は1件だけ。フェーズ内の PBI 処理も1件ずつ可視化
- **言語**: 応答・説明・コミットメッセージは日本語、コード・識別子・コード内コメントは英語。絵文字は使わない
- **Git 運用**: `git add -A` / `git add .` は使わず、対象ファイルを個別に `git add`。移動は `git mv`。コミットメッセージは Conventional Commits（`feat`/`fix`/`docs`/`refactor`/`test`/`chore`）で日本語
- **Read → Edit 順守**: `Edit` 前に必ず `Read`。`oldString` は行番号プレフィックス（`1: `）を除いた正確な内容
- **なぜなぜの品質**: 機械的に20回問い詰めるのではなく、根本原因が見えたら止める。「その解で行動に移れるか」が品質基準

---

## 使用例

**入力**: 「コードベース全体を対象にアーキテクチャ改善を一括で。PBI化から実装・検証まで自律的に」
**出力**: Phase 0（HTMLレポート 7件）→ Phase 1（RICE スコアリング → pbi/7件）→ Phase 2（RICE降順で7件を1件ずつ 5 Whys → 実装 → archived、確認なし）→ Phase 3（make clean test 2回、2件修正）→ Phase 4（版上げ）の全履歴とサマリー。

**入力**: 「積み残しはあるか？あるなら arch-delivery-loop で閉じて」
**出力**: Phase 0 の洗い出しから開始し、未完了が0になるまで全フェーズを回したサマリー。
