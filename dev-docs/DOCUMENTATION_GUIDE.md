# Documentation Guide

> Documentation inventory, i18n formatting rules, and documentation update policy. Referenced from [AGENTS.md](../AGENTS.md). Detailed i18n rules live in [docs/i18n-guide.md](../docs/i18n-guide.md); product naming rules in [NAMING_GUIDELINES.md](NAMING_GUIDELINES.md).

## User-Facing Documentation

| Document | Language | Purpose |
|----------|----------|---------|
| README.md | Bilingual (JP/EN) | Quick start guide, features overview |
| docs/SETUP_GUIDE.md | Bilingual (JP/EN) | Detailed step-by-step instructions |
| docs/OBSIDIAN_SETUP_GUIDE.md | Bilingual (JP/EN) | Obsidian integration guide with screenshots and troubleshooting |
| docs/PRIVACY.md | Bilingual (JP/EN) | Data handling transparency |
| docs/USER-GUIDE-UBLOCK-IMPORT.md | Bilingual (JP/EN) | uBlock filter features |
| docs/PII_FEATURE_GUIDE.md | Bilingual (JP/EN) | PII masking features |
| CHANGELOG.md | Mixed | Version history |

## Developer Documentation

| Document | Language | Purpose |
|----------|----------|---------|
| dev-docs/DESIGN_SPECIFICATIONS.md | English | Architecture decisions |
| dev-docs/ADR/ | English | Architecture Decision Records |
| dev-docs/ERROR_CODES.md | English | Structured error code definitions |
| CONTRIBUTING.md | Bilingual (JP/EN) | Development & contribution guide |
| AGENTS.md | English | Agent-specific guidance |

## i18n Formatting Rules

**User-Facing Docs → Bilingual Format (Japanese/English):**
- Header: `# {JP Title} / {EN Title}`
- Navigation: `[日本語](#日本語) | [English](#english)`
- Sections: `## 日本語` and `## English` in parallel
- Code/JSON: Keep untranslated

**Developer Docs → English Only:**
- AGENTS.md, DESIGN_SPECIFICATIONS.md, and other `dev-docs/*.md`

**Special Handling:**
- CHANGELOG.md: Historical entries preserved; future entries bilingual

## Documentation Update Points

Trigger updates when:
- New AI provider integrations added
- Chrome API usage changes
- Breaking changes in configuration
- Security updates or considerations
- Architecture decisions rationalized
- New user-facing features introduced

## Documentation Update Checklist

When making architectural changes that affect documentation (e.g., TypeScript migration, directory restructuring), verify and update:

- [ ] **CONTRIBUTING.md**: File paths, test naming conventions, import examples
- [ ] **AGENTS.md**: File paths in feature tables, bug fixing tables, test scenarios
- [ ] **README.md**: Any file references or technical explanations
- [ ] **Developer docs** (DESIGN_SPECIFICATIONS.md, ERROR_CODES.md, ADR/)
- [ ] **User documentation** (Setup guides, feature guides)
- [ ] **PRIVACY.md sync**: `public/PRIVACY.md` and `docs/PRIVACY.md` must stay identical. Whichever you edit, copy the same changes to the other file (Chrome Web Store reviews `public/PRIVACY.md`; a stale copy risks being flagged as inaccurate).
