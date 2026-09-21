//! Tag cooccurrence core: exact port of `computeTagCooccurrence` and
//! `narrowEntriesToTopTags` from `src/dashboard/tagCooccurrence.ts`
//! (backed by `parseTagsForDisplay` in `src/utils/tagUtils.ts`).
//!
//! The per-record double loop over tag pairs is O(T^2) with
//! `MAX_TAGS_PER_RECORD = 50` bounding it to C(50, 2) = 1225 iterations per
//! record — the dashboard's tag-cluster panel runs this over up to 10k rows
//! (~260ms of UI-thread time in TS), which is what this crate moves into
//! WASM. `limitToTopNodes` stays in TS: it sorts at most ~50 nodes.
//!
//! JS-semantics fidelity notes (all pinned by the quirks probe in
//! `outputs/probes/quirks-result.json`, iteration-2 run-1):
//! - `parseTagsForDisplay` has two formats (`#tag` whitespace-separated vs
//!   `,`-separated fallback) with a fallthrough quirk: a `#`-containing
//!   string that yields zero valid tags (e.g. `"# , tech, ai"`) falls back
//!   to comma parsing, which can produce `"#"` itself as a tag.
//! - Whitespace is the JS `\s` class (no `/u` flag), which is NOT identical
//!   to Rust's `White_Space` property (`\u0085` differs). Whitespace handling
//!   delegates to the shared js-strings crate so splits/trims agree exactly.
//! - Pair ordering and the narrow tie-break use JS `sort()` / `<`, i.e.
//!   UTF-16 code-unit order — NOT Unicode scalar order. `cmp_utf16`
//!   compares `encode_utf16` sequences so astral vs private-use tags sort
//!   exactly like the TS reference.
//! - Node/edge enumeration order is first-seen order (JS `Map` insertion
//!   order), reproduced with insertion-order vectors beside the hash maps.
//! - Lone surrogates cannot survive the `&str` boundary and become U+FFFD
//!   (same caveat as the textrank/sentence-dedup crates' jsstring.rs).

use rustc_hash::{FxHashMap, FxHashSet};

/// Kept in sync with `MAX_TAGS_PER_RECORD` in `src/utils/computeLimits.ts`.
/// Bounds the per-record double loop to C(50, 2) = 1225 iterations. The TS
/// wrapper enforces the same cap; this is defense in depth so the WASM path
/// can never become a cap bypass.
pub const MAX_TAGS_PER_RECORD: usize = 50;

/// JS `\s` without the `/u` flag: the exact set `String.split(/\s+/)` and
/// `String.trim()` in `parseTagsForDisplay` split/trim on. The member set is
/// single-sourced from the shared js-strings crate (PBI 2026-09-21-24), so a
/// `\s` membership correction cannot drift between cores.
fn is_js_space(c: char) -> bool {
    js_strings::is_js_ws_scalar(c)
}

fn trim_js(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut start = 0;
    let mut end = bytes.len();
    // Boundaries are char-aligned by construction: every member of the JS
    // space set is a char-boundary-safe scalar, and we only advance/retreat
    // past whole chars.
    while let Some(c) = s[start..end].chars().next() {
        if !is_js_space(c) {
            break;
        }
        start += c.len_utf8();
    }
    while let Some(c) = s[start..end].chars().next_back() {
        if !is_js_space(c) {
            break;
        }
        end -= c.len_utf8();
    }
    &s[start..end]
}

/// Splits on runs of JS whitespace, skipping empties. (JS
/// `split(/\s+/)` yields leading/trailing `""`, but the `#` path filters
/// everything that does not start with `#`, so dropping empties here is
/// observably identical while keeping the fallback decision exact: a
/// `#`-containing string still reaches the comma path when zero valid tags
/// survive.)
fn split_js_ws(s: &str) -> impl Iterator<Item = &str> {
    s.split(is_js_space).filter(|t| !t.is_empty())
}

/// Exact port of `parseTagsForDisplay` (`src/utils/tagUtils.ts`).
pub fn parse_tags_for_display(tags_str: &str) -> Vec<String> {
    if trim_js(tags_str).is_empty() {
        return Vec::new();
    }
    if tags_str.contains('#') {
        let mut tags = Vec::new();
        for token in split_js_ws(tags_str) {
            let t = trim_js(token);
            if !t.starts_with('#') {
                continue;
            }
            let stripped = t.trim_start_matches('#');
            if stripped.is_empty() {
                continue;
            }
            tags.push(stripped.to_string());
        }
        if !tags.is_empty() {
            return tags;
        }
    }
    tags_str
        .split(',')
        .map(trim_js)
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}

/// Compares strings in UTF-16 code-unit order, reproducing JS `sort()` and
/// the `<` tie-break in `narrowEntriesToTopTags`.
pub fn cmp_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn utf16_key(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

pub struct CooccurOutput {
    /// Tag names in first-seen order (JS `Map` insertion order).
    pub tags: Vec<String>,
    pub counts: Vec<u32>,
    /// Edges as index pairs into `tags` (pair members in UTF-16 order),
    /// in first-seen pair order.
    pub edge_a: Vec<u32>,
    pub edge_b: Vec<u32>,
    pub weights: Vec<u32>,
}

/// Ports `computeTagCooccurrence` over pre-split raw per-record tag strings.
/// Dedups per record (first occurrence wins), caps at
/// `MAX_TAGS_PER_RECORD`, accumulates node counts in first-seen order and
/// pair weights over the UTF-16-sorted copy.
pub fn compute_core(records: &[&str]) -> CooccurOutput {
    let mut index_of: FxHashMap<String, u32> = FxHashMap::default();
    let mut tags: Vec<String> = Vec::new();
    let mut counts: Vec<u32> = Vec::new();
    let mut edge_index: FxHashMap<(u32, u32), u32> = FxHashMap::default();
    let mut edge_order: Vec<(u32, u32)> = Vec::new();
    let mut weights: Vec<u32> = Vec::new();

    for raw in records {
        let parsed = parse_tags_for_display(raw);
        if parsed.is_empty() {
            continue;
        }
        // `Array.from(new Set(tags))` — first occurrence wins.
        let mut seen: FxHashSet<&str> = FxHashSet::default();
        let mut unique: Vec<&str> = Vec::with_capacity(parsed.len().min(MAX_TAGS_PER_RECORD));
        for t in &parsed {
            if seen.insert(t.as_str()) {
                unique.push(t.as_str());
                if unique.len() == MAX_TAGS_PER_RECORD {
                    // `.slice(0, MAX)` keeps the FIRST N in parse order; the
                    // rest of this record's tags are dropped before counting.
                    break;
                }
            }
        }
        for t in &unique {
            match index_of.get(*t) {
                Some(&id) => counts[id as usize] += 1,
                None => {
                    let id = tags.len() as u32;
                    index_of.insert((*t).to_string(), id);
                    tags.push((*t).to_string());
                    counts.push(1);
                }
            }
        }
        // `[...uniqueTags].sort()` — UTF-16 order, stable not needed here
        // (keys are distinct by construction).
        let mut sorted: Vec<&str> = unique;
        sorted.sort_by(|a, b| cmp_utf16(a, b));
        // Resolve to u32 ids once: the O(T^2) loop below then runs without
        // per-pair HashMap string-hash lookups.
        let ids: Vec<u32> = sorted.iter().map(|t| index_of[*t]).collect();
        for (i, &a) in ids.iter().enumerate() {
            for &b in &ids[i + 1..] {
                let pair = (a, b);
                match edge_index.get(&pair) {
                    Some(&pos) => weights[pos as usize] += 1,
                    None => {
                        let pos = edge_order.len() as u32;
                        edge_index.insert(pair, pos);
                        edge_order.push(pair);
                        weights.push(1);
                    }
                }
            }
        }
    }

    let mut edge_a = Vec::with_capacity(edge_order.len());
    let mut edge_b = Vec::with_capacity(edge_order.len());
    for (a, b) in edge_order {
        edge_a.push(a);
        edge_b.push(b);
    }
    CooccurOutput {
        tags,
        counts,
        edge_a,
        edge_b,
        weights,
    }
}

pub struct NarrowOutput {
    /// True when the unique-tag count was already within `limit`: the TS
    /// reference returns the input array unchanged (same reference), so the
    /// wrapper must do the same and `joined` is unused.
    pub unchanged: bool,
    /// Per-record rebuilt tag strings (`#tag` space-joined) in input order,
    /// `\n`-joined. Records filtered to nothing become `""`.
    pub joined: String,
}

/// Ports `narrowEntriesToTopTags`: cross-record frequency over per-record
/// deduped tags, keep-set = top `limit` by (count desc, tag UTF-16 asc),
/// then per-record filter of the FULL parse (duplicates preserved, exactly
/// like the TS `.filter`) rebuilt as `#`-joined strings.
pub fn narrow_core(records: &[&str], limit: usize) -> NarrowOutput {
    let mut freq: FxHashMap<String, u32> = FxHashMap::default();
    for raw in records {
        let parsed = parse_tags_for_display(raw);
        let mut seen: FxHashSet<&str> = FxHashSet::default();
        for t in &parsed {
            if seen.insert(t.as_str()) {
                // get_mut fast path: allocate a fresh key String only for
                // first-seen tags (entry(t.clone()) would clone per
                // occurrence even when the key already exists).
                match freq.get_mut(t.as_str()) {
                    Some(count) => *count += 1,
                    None => {
                        freq.insert(t.clone(), 1);
                    }
                }
            }
        }
    }
    if freq.len() <= limit {
        return NarrowOutput {
            unchanged: true,
            joined: String::new(),
        };
    }
    // Sort by count desc, then UTF-16 asc (the `<` tie-break). Precompute
    // UTF-16 keys once so the comparator never allocates per comparison.
    let mut ranked: Vec<(String, u32, Vec<u16>)> = freq
        .into_iter()
        .map(|(tag, count)| {
            let key = utf16_key(&tag);
            (tag, count, key)
        })
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));
    ranked.truncate(limit);
    let keep: FxHashSet<String> = ranked.into_iter().map(|(tag, _, _)| tag).collect();

    let mut rebuilt: Vec<String> = Vec::with_capacity(records.len());
    for raw in records {
        let filtered: Vec<String> = parse_tags_for_display(raw)
            .into_iter()
            .filter(|t| keep.contains(t))
            .collect();
        rebuilt.push(filtered.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" "));
    }
    NarrowOutput {
        unchanged: false,
        joined: rebuilt.join("\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hash_form() {
        assert_eq!(parse_tags_for_display("#tech #ai"), vec!["tech", "ai"]);
    }

    #[test]
    fn parse_multi_hash_and_empty_token() {
        assert_eq!(parse_tags_for_display("##tech #ai"), vec!["tech", "ai"]);
        assert_eq!(parse_tags_for_display("# #ai"), vec!["ai"]);
    }

    #[test]
    fn parse_comma_form() {
        assert_eq!(parse_tags_for_display("tech, ai"), vec!["tech", "ai"]);
        assert_eq!(parse_tags_for_display("  tech ,  ai  "), vec!["tech", "ai"]);
    }

    #[test]
    fn parse_hash_fallback_keeps_lone_hash() {
        // Quirk pin: "# ..." yields zero valid tags, so the comma fallback
        // runs and "#" itself becomes a tag.
        assert_eq!(parse_tags_for_display("# , tech, ai"), vec!["#", "tech", "ai"]);
    }

    #[test]
    fn parse_blank_inputs() {
        assert!(parse_tags_for_display("").is_empty());
        assert!(parse_tags_for_display("   ").is_empty());
    }

    #[test]
    fn parse_commas_survive_in_hash_form() {
        assert_eq!(parse_tags_for_display("#a,b #c"), vec!["a,b", "c"]);
    }

    #[test]
    fn parse_fullwidth_space_and_newline_split() {
        assert_eq!(parse_tags_for_display("#あ　#い"), vec!["あ", "い"]);
        assert_eq!(parse_tags_for_display("#a\n#b"), vec!["a", "b"]);
    }

    #[test]
    fn utf16_order_matches_js_sort() {
        // JS sort() order from the quirks probe: Z < z < é < あ < ア < 🎉.
        let mut tags = vec!["🎉", "あ", "é", "z", "ア", "Z"];
        tags.sort_by(|a, b| cmp_utf16(a, b));
        assert_eq!(tags, vec!["Z", "z", "é", "あ", "ア", "🎉"]);
    }

    #[test]
    fn utf16_order_diverges_from_scalar_order_for_pua_vs_astral() {
        // Verified against Node: ['\\uE000', '🎉'].sort() === ['🎉', '\\uE000'],
        // i.e. 🎉 < U+E000 in UTF-16 order (lead surrogate 0xD83C < 0xE000),
        // while scalar order says the opposite. The TS reference uses
        // UTF-16 order, so the core must too.
        assert_eq!(cmp_utf16("\u{E000}", "\u{1F389}"), std::cmp::Ordering::Greater);
        assert_eq!("\u{E000}".cmp("\u{1F389}"), std::cmp::Ordering::Less);
    }

    #[test]
    fn compute_pair_and_node_order() {
        let records = vec!["#b #a", "#c #a"];
        let out = compute_core(&records);
        assert_eq!(out.tags, vec!["b", "a", "c"]);
        assert_eq!(out.counts, vec![1, 2, 1]);
        // Pairs over the UTF-16-sorted copy, first-seen pair order.
        assert_eq!(out.edge_a, vec![1, 1]);
        assert_eq!(out.edge_b, vec![0, 2]);
        assert_eq!(out.weights, vec![1, 1]);
    }

    #[test]
    fn compute_dedups_within_record() {
        let records = vec!["#a #a #b"];
        let out = compute_core(&records);
        assert_eq!(out.tags, vec!["a", "b"]);
        assert_eq!(out.counts, vec![1, 1]);
        assert_eq!(out.weights, vec![1]);
    }

    #[test]
    fn compute_caps_at_50() {
        let raw: String = (0..60).map(|i| format!("#t{i:02}")).collect::<Vec<_>>().join(" ");
        let records = vec![raw.as_str()];
        let out = compute_core(&records);
        assert_eq!(out.tags.len(), 50);
        assert_eq!(out.edge_a.len(), 1225);
    }

    #[test]
    fn narrow_tie_break_is_utf16() {
        let records = vec!["#b", "#a", "#c"];
        let out = narrow_core(&records, 2);
        assert!(!out.unchanged);
        // All counts are 1: keep = [a, b] in UTF-16 order.
        assert_eq!(out.joined, "#b\n#a\n");
    }

    #[test]
    fn narrow_rebuild_uses_hash_form_in_parse_order() {
        let records = vec!["b, a", "a, c"];
        let out = narrow_core(&records, 2);
        assert!(!out.unchanged);
        assert_eq!(out.joined, "#b #a\n#a");
    }

    #[test]
    fn narrow_within_limit_is_unchanged() {
        let records = vec!["#a"];
        let out = narrow_core(&records, 50);
        assert!(out.unchanged);
    }

    #[test]
    fn narrow_filter_keeps_duplicates() {
        // The TS filter runs on the FULL parse, so duplicates survive.
        let records = vec!["#a #a #b", "#c"];
        let out = narrow_core(&records, 2);
        assert!(!out.unchanged);
        assert_eq!(out.joined, "#a #a #b\n");
    }
}
