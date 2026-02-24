# AGENTS.md

This file provides specialized guidance for different agent types when working on the Obsidian Weave Chrome extension project.

> **Note:** For general contribution guidelines (setup, testing, PR workflow), see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Overview

This is a **Manifest V3 Chrome extension** with a modular architecture:
- Service worker background script coordinates all operations
- Content script tracks user engagement on web pages
- Popup UI provides configuration and testing interface
- Modular client classes handle AI providers and Obsidian integration

### Quick References

| For Documentation | See |
|------------------|-----|
| Project Architecture | [docs/DESIGN_SPECIFICATIONS.md](docs/DESIGN_SPECIFICATIONS.md) |
| Contribution Guide | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Accessibility Guide | [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) |
| i18n Guide | [docs/i18n-guide.md](docs/i18n-guide.md) |

---

## For Feature Development Agents

### Architecture Context

The extension follows a modular design pattern:

```
Service Worker (background/)
  ├── ObsidianClient → Obsidian Local REST API
  ├── AIClient (multiple implementations) → AI Providers
  └── DOMHandler → Content injection

Popup UI (popup/)
  ├── navigation.js → Tab management
  ├── domainFilter.js → Domain filter settings
  ├── main.js → Core popup logic
  └── utils/ → Shared utilities (focusTrap, i18n, etc.)
```

### Key Patterns to Follow

1. **Modular Design**: Keep specific functionality in dedicated client classes
2. **Async/Await**: All API calls should use async/await with proper error handling
3. **Chrome Extension APIs**: Use appropriate Chrome APIs (storage, tabs, scripting)
4. **Message Passing**: Communicate between components using Chrome's message passing API
5. **Error Handling**: Always implement try-catch blocks with user notifications

### Adding New Features

| Feature Type | Location | Notes |
|--------------|----------|-------|
| UI features | `popup/` (HTML/CSS/JS) | Follow accessibility patterns (see ACCESSIBILITY.md) |
| Background processing | `background/` service-worker.js | Use modular client classes |
| Page interaction | `content/` extractor.js | Consider CSP restrictions |
| Storage | `utils/storage.js` | Use StorageKeys constant |

### Critical Considerations

- **i18n**: All user-facing text must use data-i18n attributes (see [i18n-guide.md](docs/i18n-guide.md))
- **Accessibility**: Follow WCAG 2.1 Level AA guidelines (see [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md))
- **Manifest V3**: No background scripts, use service workers
- **CSP**: Adhere to Content Security Policy

---

## For Code Review Agents

### Security Checklist

- [ ] No hardcoded API keys or sensitive data
- [ ] Proper input validation for all external data (API responses, user input)
- [ ] Safe HTML content handling (sanitize if inserting into DOM)
- [ ] Appropriate permissions requested in manifest.json
- [ ] HTTPS used for all external API calls where possible

### Chrome Extension Specific Checks

- [ ] Manifest V3 compliance (no background scripts, use service worker)
- [ ] Proper CSP (Content Security Policy) adherence
- [ ] No use of eval() or inline scripts
- [ ] Proper async handling in service worker
- [ ] Content script injection only where needed

### Code Quality Standards

- [ ] Consistent error handling with user notifications
- [ ] Proper cleanup of event listeners and intervals
- [ ] No memory leaks in long-running service worker
- [ ] Modular code organization
- [ ] Clear separation of concerns between components

---

## For Bug Fixing Agents

### Common Issue Areas & Files

| Issue Area | Primary Files |
|------------|---------------|
| API Integration Failures | `background/aiClient/*.js` |
| Obsidian Connection Issues | `background/obsidianClient.js` |
| Content Script Not Injecting | `manifest.json`, `content/extractor.js` |
| Settings Not Persisting | `utils/storage.js` |
| Duplicate Entries | `background/service-worker.js` |
| Focus Trap Issues | `popup/utils/focusTrap.js` |

### Debugging Workflow

1. Reproduce the issue consistently
2. Check browser extension error logs (`chrome://extensions`)
3. Inspect service worker logs (Extensions → Service Worker → inspect)
4. Test popup UI with browser dev tools
5. Verify API connectivity using built-in test functions

### Breaking Changes Risk

**High-risk areas:**
- Manifest permissions modifications
- Storage key structure changes
- API endpoint modifications

---

## For Security Review Agents

### Threat Model Overview

| Threat Vector | Mitigation |
|---------------|-----------|
| Data Privacy | All browsing data processed locally |
| API Keys | Stored in Chrome local storage, never logged |
| Local REST API | Self-signed certificate support |
| Content Script Injection | Runs on all web pages with user consent |
| PKI/Certificate | HTTPS with protocol/port validation |

### Security Controls

1. **API Key Protection**: Keys never logged or exposed in error messages
2. **URL Validation**: Proper validation before making requests (see `utils/urlValidator.js`)
3. **Self-signed Certificates**: Optional support for HTTPS Obsidian with custom certs
4. **Permission Minimization**: Request only necessary permissions in manifest
5. **Content Security**: CSP headers, avoid XSS vulnerabilities

### Regular Audits

- Review API endpoint configurations
- Validate content script permissions scope
- Check for data leakage in logs
- Verify secure storage of sensitive configurations
- Ensure proper HTTPS connections

---

## For Testing Agents

### Manual Testing Required

Automated tests have limitations due to Chrome Extension architecture. Manual verification needed for:

- Chrome extension loading and permissions
- Actual Chrome extension functionality
- Real AI provider API calls
- Obsidian Local REST API integration
- Content script injection on real websites

### Test Environment Setup

1. Chrome browser with Developer Mode enabled
2. Obsidian with Local REST API plugin installed
3. Valid API keys for at least one AI provider
4. Test daily notes directory structure

### Key Test Scenarios

| Scenario | Coverage |
|----------|----------|
| Multiple AI provider configurations | `aiClient/*.js` |
| Various Obsidian daily note path formats | `obsidianClient.js` |
| Different web page structures for content extraction | `extractor.js` |
| Network failure scenarios | All API clients |
| Chrome extension permission states | `manifest.json` |
| Accessibility compliance | Lighthouse/axe DevTools |
| i18n coverage | `_locales/*` messages.json |

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed testing guidelines.

---

## For Documentation Agents

### User-Facing Documentation

| Document | Language | Purpose |
|----------|----------|---------|
| README.md | Bilingual (JP/EN) | Quick start guide, features overview |
| SETUP_GUIDE.md | Bilingual (JP/EN) | Detailed step-by-step instructions |
| PRIVACY.md | Bilingual (JP/EN) | Data handling transparency |
| USER-GUIDE-UBLOCK-IMPORT.md | Bilingual (JP/EN) | uBlock filter features |
| PII_FEATURE_GUIDE.md | Bilingual (JP/EN) | PII masking features |
| CHANGELOG.md | Mixed | Version history |

### Developer Documentation

| Document | Language | Purpose |
|----------|----------|---------|
| DESIGN_SPECIFICATIONS.md | English | Architecture decisions |
| CONTRIBUTING.md | Bilingual (JP/EN) | Development & contribution guide |
| AGENTS.md | English | This file - agent-specific guidance |
| UBLOCK_MIGRATION.md | Bilingual (JP/EN) | Migration guide |

### i18n Guidelines

**User-Facing Docs → Bilingual Format (Japanese/English):**
- Header: `# {JP Title} / {EN Title}`
- Navigation: `[日本語](#日本語) | [English](#english)`
- Sections: `## 日本語` and `## English` in parallel
- Code/JSON: Keep untranslated

**Developer Docs → English Only:**
- AGENTS.md, DESIGN_SPECIFICATIONS.md

**Special Handling:**
- CHANGELOG.md: Historical entries preserved; future entries bilingual

See [i18n-guide.md](docs/i18n-guide.md) for detailed guidelines.

### Documentation Update Points

Trigger updates when:
- New AI provider integrations added
- Chrome API usage changes
- Breaking changes in configuration
- Security updates or considerations
- Architecture decisions rationalized
- New user-facing features introduced

### Localization Notes

- Primary UI language: Japanese
- Documentation: Bilingual Japanese/English
- Code comments: English for consistency
- Error messages: User-friendly, consider localization

---

## For Performance Optimization Agents

### Key Performance Metrics

- Content script injection speed
- API response times for AI summarization
- Obsidian write operation frequency
- Memory usage in service worker
- Popup UI responsiveness

### Optimization Targets

1. **Content Extraction**: Efficient DOM parsing, minimal impact on page load
2. **API Calls**: Implement request queuing, respect rate limits
3. **Storage**: Efficient Chrome storage usage, batch operations
4. **Message Passing**: Minimize chrome.runtime.sendMessage overhead
5. **Error Recovery**: Fast fallback mechanisms for failed requests

### Browser Compatibility

- Focus on modern Chrome/Chromium browsers
- Test with latest Chrome version
- Consider Manifest V3 requirements
- Account for service worker lifecycle limitations

---

## Agent Coordination Notes

When multiple agents work simultaneously:

| Primary Agent | Says Should Coordinate With | If Because |
|---------------|---------------------------|------------|
| Feature | Security | Adding new API integrations |
| Bug Fix | Documentation | User-impacting fixes |
| Performance | Feature | During new feature development |
| All | Code Review | Verify compliance with guidelines |

Respect modular architecture and avoid cross-contamination of concerns.

---

## Project-Specific Notes

### Chrome Extension Lifecycle Quirks

- Service workers can be terminated at any time (stateless)
- Content scrips reload on page navigation
- Message passing is async, no return values
- `chrome.storage.local.get/set` is preferred for state
- Not suitable for persistent background tasks

### Testing Limitations

- Cannot fully emulate Chrome Extension APIs in Jest
- Content script tests require jsdom environment
- Service worker tests have limitations
- Always verify with actual Chrome browser

### Release Considerations

Before releasing, verify:
1. [ ] All tests pass
2. [ ] Manual testing checklist complete
3. [ ] i18n coverage (both languages)
4. [ ] Accessibility audit (Lighthouse score)
5. [ ] Security review completed
6. [ ] CHANGELOG.md updated
7. [ ] Version number bumped in `manifest.json` and `package.json`