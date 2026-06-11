# PBI: 旧 GitHub Pages (obsidian-weave) を新 URL (yasumaro) へリダイレクト

## ユーザーストーリー

**エンドユーザー（既存ドキュメント閲覧者）として**、旧 URL `https://armaniacs.github.io/obsidian-weave/` にアクセスした際に自動的に新 URL `https://armaniacs.github.io/yasumaro/` へ移動してほしい、なぜなら過去のブログ・SNS・外部ドキュメントに貼られたリンクが 404 になり、参照できなくなるからだ。

---

## 背景（DEV-78 より）

リポジトリ `armaniacs/obsidian-weave` は `armaniacs/yasumaro` へリネーム済み（[2026-02-25-rename-to-obsidian-weave.md](../ADR/2026-02-25-rename-to-obsidian-weave.md) の後継リネーム、commit `3be8495`）。

それに伴い GitHub Pages が「孤児」状態になっている:

| URL | 現状 | 期待 |
|-----|------|------|
| `https://armaniacs.github.io/obsidian-weave/` | **404 Not Found** | `https://armaniacs.github.io/yasumaro/` へリダイレクト |
| `https://armaniacs.github.io/obsidian-weave/.../*` | **404 Not Found** | `https://armaniacs.github.io/yasumaro/.../*` へ同パスでリダイレクト |
| `https://armaniacs.github.io/yasumaro/` | 200 OK（正常稼働中） | 維持 |

### 技術的制約（重要）

GitHub Pages は **1ユーザー = 1ユーザーサイト** 制約がある（`armaniacs.github.io/<repo>` の `<repo>` は Project Pages としてリポジトリごとにホスト可能）。しかし現実には:

- リポジトリ `armaniacs/yasumaro` には既に `docs/` 配下のコンテンツがデプロイされている
- 旧リポジトリ名 `obsidian-weave` は存在しないため、Project Pages ホスティングが成立しない
- したがって、**旧 URL を物理的に維持するには空の `armaniacs/obsidian-weave` リポジトリを新規作成**し、そこでリダイレクト HTML を GitHub Pages 公開する必要がある

---

## ビジネス価値

- 過去記事・SNS・外部リンクの **リンク切れを 100% 解消**
- リポジトリリネーム後の **SEO 評価（被リンクジュース）の受け皿**を提供
- ユーザー体感を毀損する 404 による離脱を防止
- 既存ドキュメント（PBI #00 で実施）の obsidian-weave 表記と整合

---

## BDD受け入れシナリオ

```gherkin
Scenario: 旧サイトルートパスが新サイトへリダイレクトされる
  Given 旧リポジトリ armaniacs/obsidian-weave の GitHub Pages が有効である
  When  ブラウザで https://armaniacs.github.io/obsidian-weave/ にアクセスする
  Then  最終的に https://armaniacs.github.io/yasumaro/ のページが表示される
  And   リダイレクトのHTTPステータスコードが 200 (リダイレクト先) である

Scenario: 旧サイト配下のパスが新サイトへ同パスでリダイレクトされる
  Given 旧リポジトリ armaniacs/obsidian-weave の GitHub Pages が有効である
  When  ブラウザで https://armaniacs.github.io/obsidian-weave/typedoc/ にアクセスする
  Then  https://armaniacs.github.io/yasumaro/typedoc/ へリダイレクトされる
  And   パス末尾のサフィックス（例: /typedoc/）が保持される

Scenario: リダイレクトが即時（メタリフレッシュ）で実行される
  Given 旧URLへアクセスした
  When  HTMLレスポンスを受け取る
  Then  <head> 内に <meta http-equiv="refresh" content="..."> が含まれる
  And   <body> 内に JS フォールバック (location.replace) が含まれる
  And   ユーザー操作（JS無効環境でも）のための <a> フォールバックリンクが含まれる

Scenario: 新サイトの正常稼働がリダイレクト後も維持される
  Given 旧URL から新URL へリダイレクトした
  When  新サイトのアセット（CSS/JS/画像）をロードする
  Then  すべて 200 で取得できる
  And   コンソールに CORS / Mixed Content エラーが出ない
```

---

## 受け入れ基準

- [ ] **【手動】** GitHub 上に新規リポジトリ `armaniacs/obsidian-weave` を作成する（Public）
- [ ] **【手動】** 旧リポジトリの Settings → Pages で `main` ブランチの `/(root)` を公開元として設定
- [ ] `index.html` が配置され、`<meta http-equiv="refresh">` で新 URL へリダイレクトする
- [ ] リダイレクトがパスを保持する（`/obsidian-weave/typedoc/` → `/yasumaro/typedoc/`）
- [ ] JS フォールバック `location.replace(...)` が含まれる
- [ ] `<a href="...">` の手動クリック用フォールバックが含まれる
- [ ] HTTPS のみ（Mixed Content なし）
- [ ] **【手動】** リダイレクト動作を curl と実ブラウザで検証する
  - `curl -I https://armaniacs.github.io/obsidian-weave/` → リダイレクト先URLが含まれる or 200 を返す
  - 実ブラウザで旧 URL を踏むと 5秒以内に新 URL のコンテンツが表示される
- [ ] **【任意】** `docs/index.html` の favicon URL など、ソース内の旧 `obsidian-weave` リソース参照を確認（必要に応じて更新）

---

## テスト戦略（t_wadaスタイル）

### 統合テスト（GitHub Pages への実際のHTTPリクエスト）

- `curl -I https://armaniacs.github.io/obsidian-weave/` がリダイレクトを返すことを検証
- `curl -I https://armaniacs.github.io/obsidian-weave/typedoc/index.html` が `Location: https://armaniacs.github.io/yasumaro/typedoc/index.html` を返すことを検証（パス保持）
- 新 URL `https://armaniacs.github.io/yasumaro/` が 200 を返すことを検証（リグレッション防止）

### E2Eテスト（手動・チェックリスト）

- [ ] Chrome/Firefox/Safari それぞれで旧 URL を踏んで新 URL に着く
- [ ] JS 無効状態で `<meta http-equiv="refresh">` のみでリダイレクトされるか確認
- [ ] `/obsidian-weave/<任意のパス>` のパターンを最低 3 パターン検証
- [ ] リダイレクトループが発生しないことを確認

### 単体テスト（HTML 静的検証）

- `index.html` の存在と必須タグ含有を Node.js スクリプトで検証:
  ```bash
  test -f index.html
  grep -q '<meta http-equiv="refresh"' index.html
  grep -q 'location.replace' index.html
  grep -q 'https://armaniacs.github.io/yasumaro' index.html
  ```

---

## 実装アプローチ

### Outside-In アプローチ

1. **スパイク（手動）**: 旧リポジトリ作成 → 仮 `index.html` 配置 → Pages 有効化 → 実 URL 検証
2. **Red-Green-Refactor**: 単体チェックスクリプト → 失敗確認 → スクリプト修正 → グリーン
3. **受け入れ**: 統合テスト (curl) と E2E (手動) で BDD シナリオを全パス確認

### 実装手順

#### 1. 新規リポジトリ作成（GitHub Web UI / 手動）

- リポジトリ名: `obsidian-weave`
- Owner: `armaniacs`
- Visibility: **Public**（GitHub Pages 無料枠 + 外部アクセス可能性のため）
- 初期化: 空 README を作るかしないかは任意

#### 2. ローカルで `index.html` を作成

```bash
# 作業ディレクトリ（yasumaro とは別ディレクトリ）
mkdir -p /tmp/obsidian-weave-redirect
cd /tmp/obsidian-weave-redirect
git init
git remote add origin https://github.com/armaniacs/obsidian-weave.git
```

`index.html` を作成:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>Redirecting to Yasumaro…</title>
  <meta http-equiv="refresh" content="0; url=https://armaniacs.github.io/yasumaro/" />
  <link rel="canonical" href="https://armaniacs.github.io/yasumaro/" />
  <script>
    // パス保持リダイレクト: /obsidian-weave/foo → /yasumaro/foo
    (function () {
      var target = 'https://armaniacs.github.io/yasumaro' +
        (window.location.pathname.replace(/^\/obsidian-weave/, '') || '/') +
        (window.location.search || '') +
        (window.location.hash || '');
      window.location.replace(target);
    })();
  </script>
</head>
<body>
  <p>このサイトは <a href="https://armaniacs.github.io/yasumaro/">Yasumaro</a> へ移動しました。自動的にリダイレクトされない場合はリンクをクリックしてください。</p>
</body>
</html>
```

#### 3. コミット & プッシュ

```bash
git add index.html
git commit -m "feat: redirect obsidian-weave pages to yasumaro"
git push -u origin main
```

#### 4. GitHub Pages 有効化（手動・Web UI）

- リポジトリ → Settings → Pages
- Source: **Deploy from a branch**
- Branch: `main` / `/(root)`
- Save

#### 5. 動作検証

```bash
# 数分待ってから実行
curl -I https://armaniacs.github.io/obsidian-weave/
# 期待: 200 + <meta http-equiv="refresh"> を含む HTML

curl -I https://armaniacs.github.io/obsidian-weave/typedoc/
# 期待: 200 + リダイレクト先パスが /yasumaro/typedoc/

# 新サイトのリグレッション確認
curl -I https://armaniacs.github.io/yasumaro/
# 期待: 200
```

---

## 見積もり

**1 ストーリーポイント**（HTML 1 ファイル + 手動リポジトリ作成）

---

## 技術的考慮事項

### 依存関係
- 新規リポジトリ `armaniacs/obsidian-weave` の作成権限（GitHub org 管理者 or 個人アカウント）
- GitHub Pages 公開設定の有効化

### テスタビリティ
- 実 GitHub Pages への curl で E2E 検証可能
- HTML 単体検証は grep で代替（Node.js プロジェクトではないため、テストランナー不要）

### 非機能要件
- **性能**: リダイレクト 0 秒（`<meta http-equiv="refresh" content="0">`）
- **セキュリティ**: HTTPS のみ。Mixed Content なし。新 URL への直接リンクを `<link rel="canonical">` で示す
- **SEO**: 検索エンジンに対しリダイレクト先カノニカルを明示
- **アクセシビリティ**: `<a href>` フォールバックを必ず含める（スクリーンリーダー・JS 無効環境対応）

### 注意点
- **このリポジトリにはCI/テスト/workflow は不要**。純粋に静的 HTML 1 ファイル
- リポジトリの Description にリダイレクト目的を明記する: `Redirect archive: this repository forwards to https://armaniacs.github.io/yasumaro/`
- 旧リポジトリを Private にした場合、GitHub Pages の挙動が変動する可能性があるため **Public 維持**を推奨

---

## 実装者向け注記

### 現状コードの確認

**着手前に実行済み（2026-06-11）:**

```bash
# yasumaro リポジトリ内: GitHub Pages ワークフローの確認
ls .github/workflows/pages.yml
# → 既存。新規リポジトリの pages.yml は不要（手動設定 or default Pages 動作）

# 旧URLの実態確認
curl -sI https://armaniacs.github.io/obsidian-weave/  # → 404
curl -sI https://armaniacs.github.io/yasumaro/         # → 200

# 旧リポジトリの存在確認
gh repo view armaniacs/obsidian-weave 2>&1
# → 404 (リネーム済みで物理的に存在しない)
```

**確認結果**: 旧リダイレクト機構は未実装。新規リポジトリ作成が必要。

### 落とし穴

- **GitHub Pages の反映には 1〜5 分かかる**: 設定後すぐに curl すると 404 が返ることがある。`gh api repos/armaniacs/obsidian-weave/pages` で `status: built` を確認してから検証する
- **`/obsidian-weave/` 自体もリポジトリルート扱い**: `<meta http-equiv="refresh" content="0; url=...">` の URL 末尾 `/` を必ず含める
- **パス保持の JS で `location.pathname.replace(/^\/obsidian-weave/, '')`**: `/obsidian-weave` を取り除いた残りを新URLに連結する。先頭 `/` を残すか調整
- **既存リポジトリ名の予約**: GitHub 上に既に `armaniacs/obsidian-weave` という別 Organization 等のリポジトリが存在すると作成できない（要事前確認）
- **GitHub Pages 設定はリポジトリの Settings → Pages から手動**: `gh repo edit` コマンドでは設定不可
- **このPBIは yasumaro リポジトリの変更を伴わない**: 別リポジトリへの作業。新規ディレクトリ `/tmp/obsidian-weave-redirect` 等で作業する

---

## Definition of Done

- [x] 新規リポジトリ `armaniacs/obsidian-weave` が作成されている（id: 1265668676）
- [x] `index.html` が配置されリダイレクト用コンテンツが含まれる（コミット `00581ea`）
- [x] `404.html` も配置され、サブパスへのリクエストもリダイレクトされる（コミット `14a1879`）
- [x] GitHub Pages が有効化されている（`status: built`, `https_enforced: true`）
- [x] BDD シナリオ 4 件すべてがパスする（Playwright E2E 4/4 PASS、2026-06-11 検証）
- [x] 単体チェック（HTML 必須タグ含有）がパスする（6/6 OK）
- [x] 新 URL `https://armaniacs.github.io/yasumaro/` のリグレッションがない（200 維持）
- [x] リポジトリ Description にリダイレクト目的が明記されている（`Redirect archive: forwards to https://armaniacs.github.io/yasumaro/`）
- [x] リポジトリ Homepage が新 URL に設定されている
- [ ] yasumaro 本リポジトリのドキュメント（README.md 等）の旧 URL 参照があれば、必要に応じて更新

## 実装ログ

| 日時 | 作業 |
|------|------|
| 2026-06-11 | 新リポジトリ `armaniacs/obsidian-weave` 作成（gh CLI） |
| 2026-06-11 | `index.html` コミット（パス保持 JS + メタリフレッシュ + `<a>` フォールバック） |
| 2026-06-11 | `404.html` コミット（サブパス対応） |
| 2026-06-11 | GitHub Pages API 有効化（`source: main, path: /`） |
| 2026-06-11 | ビルド完了・E2E 4/4 PASS・Description/Homepage 設定 |

### 検証結果

```
=== Final E2E regression run ===
PASS: old/                          → https://armaniacs.github.io/yasumaro/
PASS: old/typedoc/                  → https://armaniacs.github.io/yasumaro/typedoc/
PASS: old/typedoc/index.html        → https://armaniacs.github.io/yasumaro/typedoc/index.html
PASS: old/some/random/path          → https://armaniacs.github.io/yasumaro/some/random/path
Summary: 4/4
```

### 補足（DEV-78 スコープ外）

- yasumaro 本リポジトリの `docs/index.html` の `<title>` が "Obsidian Weave" のまま残っていた（リダイレクト検証時に観測）。リネーム追跡タスクとして別 PBI 起票を推奨
