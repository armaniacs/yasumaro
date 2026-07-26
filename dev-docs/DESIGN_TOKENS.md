# Design Tokens

Source of truth: [`src/styles/tokens.css`](../src/styles/tokens.css). This document explains the design
philosophy behind the tokens and gives a quick-reference table; when the two disagree, the CSS file wins.

## Concept: 研墨 (Kenboku)

> 知識を蓄え、記録し、伝承する道具としての美学。墨と紙と金。
> (The aesthetic of a tool that accumulates, records, and passes on knowledge. Ink, paper, and gold.)

Yasumaro records browsing history the way an inkstone (硯, *suzuri*) grinds ink (墨, *sumi*) onto paper
(紙, *kami*) — a quiet, deliberate act of preserving what would otherwise be forgotten. The token set
reflects this via three material references:

- **墨 (sumi, ink)** — the near-black/near-white base tones used for text and dark-mode backgrounds
  (`--ym-color-ink-*`, `--ym-color-sumi-*`).
- **紙 (kami, paper)** — the warm off-white base used for light-mode backgrounds
  (`--ym-color-paper*`).
- **金 (kin, gold)** — a restrained gold accent reserved for decoration only, never for interactive
  elements (`--ym-color-gold*`). Interactive/operational elements (buttons, links, focus states) use a
  separate purple accent (`--ym-color-primary*`) so gold stays purely ornamental and never competes with
  it for the user's attention.

This split — decorative gold vs. operational purple — is the one rule worth remembering when adding new
UI: **if it's clickable, it's purple; if it's just an accent, it can be gold.**

## Naming convention

- `--ym-*` — Yasumaro design tokens, defined once in `tokens.css`. Use these for all new code.
- `--color-*` — legacy variables from before the token system existed, mid-migration (see PBI-14 in the
  file header). Don't add new `--color-*` usages; migrate to `--ym-*` when touching nearby code.

## Usage

Each entry point (`dashboard.css`, `popup/styles.css`) imports the token file first:

```css
@import url('../styles/tokens.css');
```

## Token reference

### Color — brand core

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ym-color-ink-black` | `#0e0e12` | `#0e0e12` | Lacquer black — dark-mode base background |
| `--ym-color-ink-deep` | `#1a1a24` | `#1a1a24` | Ink — dark-mode sidebar background |
| `--ym-color-ink-mid` | `#2a2a38` | `#2a2a38` | Inkstone — border / card background (dark) |
| `--ym-color-gold` | `#c9a84c` | `#c9a84c` | Gold leaf — decorative accent only |
| `--ym-color-gold-light` | `#e8c97a` | `#e8c97a` | Gold hover |
| `--ym-color-gold-dim` | `rgba(201,168,76,.15)` | same | Gold background tint |
| `--ym-color-paper` | `#f5f0e8` | `#0e0e12` | Washi paper — light-mode base background |
| `--ym-color-paper-warm` | `#ede7d9` | `#1a1a24` | Deep washi — light-mode sidebar background |
| `--ym-color-sumi-text` | `#1e1a14` | `#f0ece4` | Sumi ink — primary text |
| `--ym-color-sumi-muted` | `#7a7060` | `#9a9080` | Faint sumi — secondary text |

### Color — operational (purple, never gold)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ym-color-primary` | `#7c3aed` | `#c084fc` | Primary interactive accent |
| `--ym-color-primary-hover` | `#6d28d9` | `#a855f7` | Hover state |
| `--ym-color-primary-light` | `rgba(124,58,237,.1)` | `rgba(192,132,252,.15)` | Light background tint |
| `--ym-color-primary-bg` | `#f5f3ff` | `#1a1025` | Section background |
| `--ym-color-primary-border` | `#ddd6fe` | `#6b21a8` | Border |

### Color — semantic (danger / success / warning / info)

Each has `-hover` (danger/warning only), `-text`, `-bg`, `-border` variants; see `tokens.css` §1–2 for the
full light/dark value tables. Base hues:

| Token | Light | Dark |
|---|---|---|
| `--ym-color-danger` | `#ef4444` | `#f85149` |
| `--ym-color-success` | `#10b981` | `#3fb950` |
| `--ym-color-warning` | `#f59e0b` | `#d29922` |
| `--ym-color-info` | `#3b82f6` | `#58a6ff` |

### Typography

| Token | Value | Usage |
|---|---|---|
| `--ym-font-ui` | Noto Sans JP / Hiragino Sans / system-ui stack | Default UI typeface (gothic) |
| `--ym-font-mono` | SF Mono / JetBrains Mono / Consolas stack | Code / monospace |
| `--ym-font-serif` | Hiragino Mincho / Yu Mincho / Georgia stack | Opt-in serif (settings option only) |
| `--ym-text-xs` | 11px | Labels, badges |
| `--ym-text-sm` | 13px | Captions, supplementary text |
| `--ym-text-base` | 14px | Body text |
| `--ym-text-md` | 16px | Section headings |
| `--ym-text-lg` | 20px | Panel headings |
| `--ym-text-xl` | 28px | Brand name |

### Spacing

8px-ish scale from `--ym-space-1` (4px) to `--ym-space-8` (32px); `--ym-space-7` (28px) exists specifically
to fill a gap in the existing scale — see `tokens.css` §4.

### Border radius

`--ym-radius-sm` (6px), `--ym-radius`/`--ym-radius-md` (8px, both point to the same value — `-md` was added
because existing code referenced it without a definition), `--ym-radius-lg` (12px), `--ym-radius-full`
(9999px, pills/circles).

### Motion

- `--ym-ease-ink` — slow-release cubic-bezier evoking ink bleeding into paper; use for elements settling
  into place.
- `--ym-ease-paper` — accelerating curve evoking a page turn; use for elements entering/exiting.
- Durations: `--ym-duration-sm` (120ms), `-md` (220ms), `-lg` (380ms).
- All motion durations collapse to `0.01ms` under `@media (prefers-reduced-motion: reduce)` — see
  `tokens.css` §8. Any new animated property must respect this, either by using the duration tokens
  directly or by adding an explicit reduced-motion override.

### Texture / effects

- `--ym-paper-lines` — a faint repeating horizontal-line gradient evoking washi paper texture. Light mode
  only (not redefined under the dark-mode media query).
- `--ym-focus-ring-gold` — decorative two-layer gold focus ring, for **non-operational** emphasized
  elements only.
- `--ym-focus-ring` — standard purple focus ring for interactive elements; prioritizes contrast over
  decoration.

## Adding a new token

1. Decide which of the 8 sections in `tokens.css` it belongs to (color / typography / spacing / radius /
   motion / texture).
2. Follow the `--ym-*` naming convention — never add new `--color-*` variables.
3. If it's a color, define both the light-mode (`:root`) and dark-mode (`@media (prefers-color-scheme:
   dark)`) value, even if they're identical (see `--ym-color-ink-black` for an example of an intentionally
   unchanged dark-mode value).
4. Ask: is this decorative (can be gold) or operational (must be purple)? Get this wrong and the UI reads
   as visually inconsistent with the rest of the extension.
5. Update this document's reference table.
