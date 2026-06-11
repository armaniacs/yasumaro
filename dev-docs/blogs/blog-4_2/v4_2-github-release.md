## What's New in v4.2

You can now see at a glance whether a page was recorded or privacy-detected — without opening the popup.

### 🔶 Privacy Detection Badge `!`

When `Cache-Control: private`, `Set-Cookie`, or `Authorization` headers are detected, an orange `!` badge appears on the toolbar icon. Auto-recording is paused on these pages. The badge clears when you open the popup.

### 🔵 Auto-Save Badge `◎`

When a page is auto-recorded, a blue `◎` badge appears on the toolbar icon. It stays visible while you're on that tab — even if you switch to another tab and come back. It clears when you navigate to a new page in the same tab.

| Badge | Color | Meaning |
|-------|-------|---------|
| `!` | Orange | Privacy header detected. Auto-recording paused. |
| `◎` | Blue | Auto-recording completed. |
| (none) | — | Normal state. |

### 🤖 5 AI Prompt Presets

Open the "Prompt" panel in the dashboard to find 5 built-in presets:

| Preset | Output |
|--------|--------|
| Default | 1–2 sentence summary in Japanese |
| With Tags | `#category` tag + 1-line summary |
| Bullet Points | 3-point bullet list in Japanese |
| English Summary | 1–2 sentence summary in English |
| Technical | 3 technical highlights in Japanese |

Click **Activate** to use a preset. To customize, use **Duplicate** to copy it as a new custom prompt.

### 🚫 "Record Anyway" Button for Blocked Domains

When you open the popup on a domain in your block list, the record button changes to **"Record Anyway"**. This lets you save that single page without changing your block settings.

---

## 日本語

ポップアップを開かなくても、「記録された」「プライバシー検出が走っている」がツールバーアイコンのバッジでわかるようになりました。

### 🔶 プライバシー検出バッジ `!`

`Cache-Control: private` などのヘッダーを検出すると、ツールバーアイコンにオレンジの `!` バッジが表示されます。自動記録が止まっていることをポップアップなしで確認できます。バッジはポップアップを開くと消えます。

### 🔵 自動保存バッジ `◎`

ページが自動記録されると、ツールバーアイコンに青の `◎` バッジが表示されます。そのタブにいる間は表示し続け、同じタブで別のページに遷移したときに消えます。

| バッジ | 色 | 意味 |
|-------|----|------|
| `!` | オレンジ | プライバシーヘッダー検出。自動記録が止まっている |
| `◎` | 青 | 自動記録が完了した |
| （なし） | — | 通常状態 |

### 🤖 AIプロンプトプリセット 5種類

ダッシュボードの「プロンプト」パネルに5種類のプリセットが追加されました。

| プリセット | 出力形式 |
|-----------|---------|
| デフォルト | 日本語で1〜2文の簡潔な要約 |
| タグ付き要約 | `#カテゴリ` タグ + 1行要約 |
| 箇条書き | 日本語で3点の箇条書き |
| 英語要約 | 英語で1〜2文の要約 |
| 技術的観点 | 技術的なポイントを日本語で3点 |

「有効化」で使用開始、「複製」でカスタムプロンプトとしてコピーして編集できます。

### 🚫 ブロック中ドメインの「それでも記録」

ブロックリストに含まれるサイトでポップアップを開くと、記録ボタンが「それでも記録」に変わります。ブロック設定を変えずに、そのページだけを1回記録できます。

---

**Full changelog**: [CHANGELOG.md](https://github.com/armaniacs/obsidian-weave/blob/main/CHANGELOG.md)
