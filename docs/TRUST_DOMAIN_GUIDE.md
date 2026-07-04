# ドメイン信頼度判定ガイド / Domain Trust Evaluation Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro の**ドメイン信頼度判定**機能は、ユーザーが閲覧している Web サイトのドメインに対して信頼レベルを評価し、ポップアップのステータスパネルに表示する機能です。金融サイトや未検証サイトへの注意喚起、公式ドメインや人気サイトの信頼表示などを視覚的に伝え、記録時の判断を補助します。

本機能で使用するデータは拡張機能内に保持され、ドメイン判定はローカルで行われます。外部へ閲覧履歴が送信されることはありません。

> [!NOTE]
> 現在の実装では、信頼度判定は主に**ステータス表示と警告表示**に使用されます。`LOCKED` レベル以外では、自動的に記録をブロックすることはありません。

---

### Trust Level（信頼レベル）

ドメインは以下の 4 つのレベルに分類されます。

| レベル | 表示色 | 意味 |
|--------|--------|------|
| **TRUSTED** | 緑 | 信頼済みドメイン。公式機関、教育機関、Tranco 上位ドメインなど。 |
| **SENSITIVE** | 黄 | 要注意ドメイン。金融、ゲーム、SNS、またはユーザーが追加した警戒ドメイン。 |
| **UNVERIFIED** | 灰 | 未検証ドメイン。いずれの信頼リストにも含まれていないドメイン。 |
| **LOCKED** | グレー（暗め） | ブロック対象ドメイン。スキーマ上は存在し、TrustChecker はこのレベルを受け取ると記録をブロックしますが、現時点では通常の判定フローで返されることはありません。将来の機能拡張用に予約されています。 |

---

### 判定ロジック（3-Step Verification）

ドメインの信頼レベルは、以下の順序で 3 段階のチェックを行い、最初に一致した段階で結果が確定します。

```
入力された URL
    │
    ▼
Step 1: JP-Anchor TLD 判定
    │ 一致 → TRUSTED
    │ 不一致
    ▼
Step 2: Sensitive List 判定
    │ 一致 → SENSITIVE
    │ 不一致
    ▼
Step 3: Tranco 判定
    │ 一致 → TRUSTED
    │ 不一致
    ▼
UNVERIFIED
```

#### Step 1: JP-Anchor TLD 判定

ドメインの末尾が日本の公式・公共 TLD と一致するかを確認します。

**初期設定の TLD:**

- `.go.jp`（政府機関）
- `.ac.jp`（教育機関）
- `.lg.jp`（地方公共団体）

ユーザーはこのリストに独自の TLD（例: `.ed.jp`）を追加できます。

#### Step 2: Sensitive List 判定

金融、ゲーム、SNS などのカテゴリに属するドメインを検出します。判定は以下の順序で行われます。

1. **ホワイトリスト**: ユーザーが明示的に除外したドメインは `TRUSTED` とします。
2. **ユーザーブラックリスト**: ユーザーが追加したドメインは `SENSITIVE` とします。
3. **プリセットカテゴリ照合**: 金融、ゲーム、SNS の各リストと照合します。

**初期設定のカテゴリ例:**

- **金融**: 日本の主要銀行、証券、クレジットカード会社など
- **ゲーム**: 主要ゲームメーカー・プラットフォーム
- **SNS**: 主要ソーシャルメディア

#### Step 3: Tranco 判定

[Tranco List](https://tranco-list.eu/) という Web サイトの人気ランキングデータと照合します。サブドメインを除去して親ドメインも候補に含め、上位ドメインに一致すれば `TRUSTED` とします。

例: `edition.cnn.com` → `cnn.com` も候補として評価

> [!IMPORTANT]
> Tranco 判定を有効にするには、ダッシュボードの「Trust」タブから「Tranco List を更新」を実行する必要があります。更新前は Tranco リストが空のため、JP-Anchor TLD 判定と Sensitive List 判定のみが行われます。

---

### Safety Mode と Tranco Tier

**Safety Mode** は、Tranco リストのどこまでを信頼済みとみなすかを制御します。ダッシュボードの「Trust」タブで変更できます。

| Safety Mode | Tranco Tier | 信頼範囲 |
|-------------|-------------|----------|
| **Strict（厳格）** | Top 1,000 | Tranco 上位 1,000 ドメインのみ信頼 |
| **Balanced（バランス）** | Top 10,000 | Tranco 上位 10,000 ドメインまで信頼（初期設定） |
| **Relaxed（緩和）** | Top 100,000 | Tranco 上位 100,000 ドメインまで信頼 |

Safety Mode を変更すると、対応する Tranco Tier も連動して変更されます。Tranco Tier は Safety Mode とは独立して手動で変更することもできます。

---

### Alert Settings（警告設定）

ポップアップに警告を表示する条件を設定できます。ダッシュボードの「Trust」タブで変更できます。

| 設定項目 | 初期値 | 動作 |
|----------|--------|------|
| **金融サイトの警告** | ON | `SENSITIVE` かつ `finance` カテゴリのドメインで警告を表示 |
| **警戒ドメインの警告** | ON | `SENSITIVE` かつ `gaming` / `sns` カテゴリのドメインで警告を表示 |
| **未検証サイトの警告** | OFF | `UNVERIFIED` のドメインで警告を表示 |

> [!TIP]
> 警戒ドメインや未検証サイトでも記録自体は行われます。警告はあくまで視覚的な注意喚起です。

---

### カスタムリストの使い方

ダッシュボードの「Trust」タブで、以下のカスタムリストを管理できます。

#### JP-Anchor TLD

信頼済み TLD を追加できます。先頭のドット（`.`）を含めて入力してください。

- 追加例: `.ed.jp`、`.co.jp`
- 削除: 一覧の `×` ボタンで削除

#### Sensitive List（警戒ドメイン）

金融・ゲーム・SNS 以外でも、ユーザーが警告対象としたいドメインを追加できます。

- 追加例: `example.com`
- カテゴリは `finance`、`gaming`、`sns` のいずれかを選択

#### Whitelist（ホワイトリスト）

Sensitive List に含まれていても、警告を出したくないドメインを登録できます。

- 追加例: `trusted.example.com`
- ホワイトリストに登録されたドメインは `TRUSTED` と判定されます

---

### Tranco List の更新

Tranco List は初期状態では空です。手動で最新のリストを取得することで、Tranco ベースの信頼判定が有効になります。

#### 手動更新

ダッシュボードの「Trust」タブで「Tranco List を更新」をクリックします。

#### 更新の流れ

```
1. 最新リスト ID を Tranco API から取得
2. 選択中の Tier に応じた CSV をダウンロード
3. ドメインリストを検証
4. Trust Database を更新
5. ポップアップに更新結果を表示
```

#### 更新同意

Tranco List の更新には、外部 API（`tranco-list.eu`）へのアクセスが必要です。初回更新時に同意を求められます。

- **同意する**: リストをダウンロードして更新
- **拒否する / 後で**: 30 日後に再度確認を表示

同意拒否中、または更新を実行するまでは Tranco リストが空のため、Step 3 の Tranco 判定は機能しません。JP-Anchor TLD 判定と Sensitive List 判定は引き続き動作します。

#### 変更通知

Tranco List が更新された際、以下の条件を満たすと通知が表示されます。

- 今まで訪問していた Tranco ドメインが新しいリストから除外された
- 前回の通知から 7 日以上経過している

通知には除外されたドメインが一覧表示されます。

---

### プライバシーとセキュリティ

#### ローカル処理

ドメイン信頼度判定に使用されるすべてのリスト（JP-Anchor、Sensitive、Tranco）は、拡張機能内の `chrome.storage.local` に保存されます。判定処理もローカルで行われ、閲覧履歴やドメイン情報が外部に送信されることはありません。

#### 高速判定のための Bloom Filter

Sensitive List や Tranco List の照合には、メモリ効率の良い **Bloom Filter** を使用しています。これにより、大量のドメインに対して高速に候補を絞り込みます。

> [!NOTE]
> Bloom Filter は確率的なデータ構造で、まれに「実際はリストにないのに含まれると判定される」偽陽性が発生することがあります。Yasumaro では、Bloom Filter で候補に絞った後に精密照合を行うため、偽陽性は排除されています。

#### データの整合性

Trust Database の更新には**楽観的ロック**を使用し、複数の処理が同時に書き込む際のデータ不整合を防いでいます。

---

### トラブルシューティング

#### Q1. ポップアップに「Trust」が表示されない

以下を確認してください。

- 拡張機能が最新版である
- 対象ページが `http://` または `https://` で始まっている
- プライバシー保護のための特殊ページ（`chrome://` など）ではない

#### Q2. 信頼済みのはずのドメインが UNVERIFIED と表示される

- Tranco List が更新されているか確認してください。ダッシュボードの「Trust」タブで「Tranco List を更新」を試してください。
- Safety Mode が `Strict` になっていないか確認してください。
- ドメインがホワイトリストに登録されている場合は、`TRUSTED` と判定されます。

#### Q3. 金融サイトで警告が表示されない

- ダッシュボードの「Trust」タブで「金融サイトの警告」が ON になっているか確認してください。
- 対象ドメインが Sensitive List の `finance` カテゴリに含まれている必要があります。含まれていない場合は手動で追加してください。

#### Q4. Tranco List の更新に失敗する

- ネットワーク接続を確認してください。
- `tranco-list.eu` へのアクセスがブロックされていないか確認してください。
- 拡張機能を再読み込みしてから再度お試しください。

---

## English

### Overview

Yasumaro's **Domain Trust Evaluation** feature assesses the trust level of the website you are visiting and displays it in the popup's status panel. It visually informs you about trustworthy sites, such as official or popular domains, and warns you about sensitive or unverified sites to help you decide whether to record the page.

All data used for evaluation is stored inside the extension, and the evaluation itself is performed locally. Your browsing history or domain information is never sent externally.

> [!NOTE]
> In the current implementation, trust evaluation is used primarily for **status display and warning indicators**. Except for the `LOCKED` level, it does **not** automatically block recording.

---

### Trust Level

Domains are classified into one of four levels.

| Level | Color | Meaning |
|-------|-------|---------|
| **TRUSTED** | Green | Trusted domains, such as official institutions, educational sites, and top Tranco-ranked sites. |
| **SENSITIVE** | Amber | Caution-worthy domains, such as finance, gaming, SNS, or user-added warning domains. |
| **UNVERIFIED** | Gray | Unverified domains that are not included in any trusted list. |
| **LOCKED** | Dark gray | Blocked domains. The level exists in the schema and TrustChecker blocks recording when it receives this level, but it is not currently returned by the normal evaluation flow. Reserved for future feature expansion. |

---

### Evaluation Logic (3-Step Verification)

A domain's trust level is determined by three sequential checks. The first matching check determines the final result.

```
Input URL
    │
    ▼
Step 1: JP-Anchor TLD check
    │ Match → TRUSTED
    │ No match
    ▼
Step 2: Sensitive List check
    │ Match → SENSITIVE
    │ No match
    ▼
Step 3: Tranco check
    │ Match → TRUSTED
    │ No match
    ▼
UNVERIFIED
```

#### Step 1: JP-Anchor TLD Check

Checks whether the domain ends with an official Japanese public TLD.

**Default TLDs:**

- `.go.jp` (government)
- `.ac.jp` (academic)
- `.lg.jp` (local government)

You can add custom TLDs, such as `.ed.jp`.

#### Step 2: Sensitive List Check

Detects domains belonging to categories such as finance, gaming, or SNS. The check follows this order:

1. **Whitelist**: Domains explicitly excluded by the user are treated as `TRUSTED`.
2. **User blacklist**: Domains added by the user are treated as `SENSITIVE`.
3. **Preset category matching**: Matched against finance, gaming, and SNS preset lists.

**Default category examples:**

- **Finance**: Major Japanese banks, securities firms, credit card companies
- **Gaming**: Major game publishers and platforms
- **SNS**: Major social media services

#### Step 3: Tranco Check

Matches against the [Tranco List](https://tranco-list.eu/), a popularity ranking of websites. Subdomains are stripped so parent domains are also evaluated. If a match is found, the domain is `TRUSTED`.

Example: `edition.cnn.com` → `cnn.com` is also evaluated as a candidate.

> [!IMPORTANT]
> To enable Tranco evaluation, you must run "Update Tranco List" from the dashboard's "Trust" tab. Until then, the Tranco list is empty, so only the JP-Anchor TLD check and Sensitive List check are performed.

---

### Safety Mode and Tranco Tier

**Safety Mode** controls how much of the Tranco list is considered trusted. You can change it in the dashboard's "Trust" tab.

| Safety Mode | Tranco Tier | Trust Range |
|-------------|-------------|-------------|
| **Strict** | Top 1,000 | Only Tranco top 1,000 domains are trusted |
| **Balanced** | Top 10,000 | Tranco top 10,000 domains are trusted (default) |
| **Relaxed** | Top 100,000 | Tranco top 100,000 domains are trusted |

Changing Safety Mode updates the corresponding Tranco Tier. You can also change the Tranco Tier independently of Safety Mode.

---

### Alert Settings

You can configure when warnings are shown in the popup. These settings are available in the dashboard's "Trust" tab.

| Setting | Default | Behavior |
|---------|---------|----------|
| **Financial site warning** | ON | Shows a warning for `SENSITIVE` domains in the `finance` category |
| **Sensitive site warning** | ON | Shows a warning for `SENSITIVE` domains in the `gaming` or `sns` categories |
| **Unverified site warning** | OFF | Shows a warning for `UNVERIFIED` domains |

> [!TIP]
> Recording still occurs for sensitive or unverified domains. Warnings are purely visual reminders.

---

### Custom Lists

The dashboard's "Trust" tab allows you to manage the following custom lists.

#### JP-Anchor TLD

Add TLDs that should be considered trusted. Include the leading dot (`.`).

- Example: `.ed.jp`, `.co.jp`
- Remove: Click the `×` button next to an entry

#### Sensitive List

Add domains you want to flag, beyond the default finance/gaming/SNS categories.

- Example: `example.com`
- Choose a category: `finance`, `gaming`, or `sns`

#### Whitelist

Register domains that should never show a warning, even if they appear in the Sensitive List.

- Example: `trusted.example.com`
- Whitelisted domains are evaluated as `TRUSTED`

---

### Updating the Tranco List

The Tranco List is empty by default. You can manually fetch the latest list to enable Tranco-based trust evaluation.

#### Manual Update

Click "Update Tranco List" in the dashboard's "Trust" tab.

#### Update Flow

```
1. Fetch the latest list ID from the Tranco API
2. Download the CSV for the selected Tier
3. Validate the domain list
4. Update the Trust Database
5. Show the result in the popup
```

#### Update Consent

Updating the Tranco List requires accessing the external API at `tranco-list.eu`. You will be asked for consent on the first update.

- **Grant**: Download and update the list
- **Deny / Later**: Confirmation will be shown again after 30 days

While consent is denied, or until you run the update, the Tranco list remains empty and Step 3 (Tranco check) does not run. The JP-Anchor TLD check and Sensitive List check continue to work.

#### Change Notifications

When the Tranco List is updated, a notification is shown if all of the following are true:

- A previously visited Tranco domain has been removed from the new list
- At least 7 days have passed since the last notification

The notification lists the removed domains.

---

### Privacy and Security

#### Local Processing

All lists used for domain trust evaluation (JP-Anchor, Sensitive, Tranco) are stored in the extension's `chrome.storage.local`. Evaluation is performed locally, and neither browsing history nor domain information is sent externally.

#### Bloom Filter for Fast Evaluation

Sensitive List and Tranco matching use a **Bloom Filter**, a memory-efficient data structure that quickly narrows down candidates from large domain lists.

> [!NOTE]
> A Bloom Filter is a probabilistic structure that can rarely produce a false positive (reporting a domain as present when it is not). Yasumaro performs an exact-match verification after Bloom Filter screening, so false positives are eliminated.

#### Data Integrity

Trust Database updates use an **optimistic lock** to prevent data inconsistency when multiple processes write concurrently.

---

### Troubleshooting

#### Q1. "Trust" is not shown in the popup

Check the following:

- The extension is up to date
- The page uses `http://` or `https://`
- The page is not a special page such as `chrome://`

#### Q2. A domain I expect to be trusted is shown as UNVERIFIED

- Check whether the Tranco List has been updated. Try "Update Tranco List" in the dashboard's "Trust" tab.
- Verify that Safety Mode is not set to `Strict`.
- If the domain is on the whitelist, it will be evaluated as `TRUSTED`.

#### Q3. No warning appears on a financial site

- In the dashboard's "Trust" tab, ensure "Show financial site warning" is ON.
- The domain must be in the `finance` category of the Sensitive List. If not, add it manually.

#### Q4. Tranco List update fails

- Check your network connection.
- Ensure access to `tranco-list.eu` is not blocked.
- Try reloading the extension and updating again.

---

## 関連ドキュメント / Related Documents

- [セットアップガイド / Setup Guide](SETUP_GUIDE.md)
- [Obsidian 連携ガイド / Obsidian Setup Guide](OBSIDIAN_SETUP_GUIDE.md)
- [よくある質問 / FAQ](FAQ.md)
- [プライバシーポリシー / Privacy Policy](PRIVACY.md)
