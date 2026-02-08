# AGENTS.md

This file provides specialized guidance for different agent types when working on the Obsidian Smart History Chrome extension project.

## For Feature Development Agents (IMPORTANT: Read [DESIGN_SPECIFICATIONS.md](docs/DESIGN_SPECIFICATIONS.md) first)

### Architecture Context
This is a Manifest V3 Chrome extension with a modular architecture:
- Service worker background script coordinates all operations
- Content script tracks user engagement on web pages
- Popup UI provides configuration and testing interface
- Modular client classes handle AI providers and Obsidian integration

### Key Patterns to Follow
1. **Modular Design**: Keep specific functionality in dedicated client classes (aiClient.js, obsidianClient.js)
2. **Async/Await**: All API calls should use async/await with proper error handling
3. **Chrome Extension APIs**: Use appropriate Chrome APIs (storage, tabs, scripting)
4. **Message Passing**: Communicate between components using Chrome's message passing API
5. **Error Handling**: Always implement try-catch blocks with user notifications

### Adding New Features
1. UI features: Modify popup HTML/CSS/JS files
2. Background processing: Update service-worker.js or create new client modules
3. Page interaction: Enhance extractor.js content script
4. Storage: Extend storage.js with new keys and getters/setters

## For Code Review Agents

### Security Checklist
- ☐ No hardcoded API keys or sensitive data
- ☐ Proper input validation for all external data (API responses, user input)
- ☐ Safe HTML content handling (sanitize if inserting into DOM)
- ☐ Appropriate permissions requested in manifest.json
- ☐ HTTPS used for all external API calls where possible

### Chrome Extension Specific Checks
- ☐ Manifest V3 compliance (no background scripts, use service worker)
- ☐ Proper CSP (Content Security Policy) adherence
- ☐ No use of eval() or inline scripts
- ☐ Proper async handling in service worker
- ☐ Content script injection only where needed

### Code Quality Standards
- ☐ Consistent error handling with user notifications
- ☐ Proper cleanup of event listeners and intervals
- ☐ No memory leaks in long-running service worker
- ☐ Modular code organization
- ☐ Clear separation of concerns between components

## For Bug Fixing Agents

### Common Issue Areas
1. **API Integration Failures**: Check aiClient.js for proper error handling and API endpoints
2. **Obsidian Connection Issues**: Verify obsidianClient.js protocol/port handling
3. **Content Script Not Injecting**: Check manifest permissions and content script matches
4. **Settings Not Persisting**: Review storage.js implementation
5. **Duplicate Entries**: Check URL deduplication logic in service-worker.js

### Debugging Workflow
1. Reproduce the issue using Consistently
2. Check browser's extension error logs (chrome://extensions)
3. Inspect service worker logs (Extensions → Service Worker → inspect)
4. Test popup UI with browser dev tools
5. Verify API connectivity using built-in test functions

### Test Scenarios
- Multiple AI provider configurations
- Various Obsidian daily note path formats
- Different web page structures for content extraction
- Network failure scenarios
- Chrome extension permission states

## For Security Review Agents

### Threat Model
- **Data Privacy**: All browsing data processed locally, only summaries sent to AI providers
- **API Keys**: Stored in Chrome local storage, sent only to configured services
- **Local REST API**: Obsidian connection requires local network access
- **Content Script Injection**: Runs on all web pages with user consent

### Security Controls
1. **API Key Protection**: Keys never logged or exposed in error messages
2. **URL Validation**: Proper validation before making requests
3. **Self-signed Certificates**: Optional support for HTTPS Obsidian with custom certs
4. **Permission Minimization**: Request only necessary permissions in manifest
5. **Content Security**: Use CSP headers, avoid XSS vulnerabilities

### Regular Audits
- Review API endpoint configurations
- Validate content script permissions scope
- Check for data leakage in logs
- Verify secure storage of sensitive configurations
- Ensure proper encryption for HTTPS connections

## For Documentation Agents

### User-Facing Documentation
- **README.md**: Bilingual (Japanese/English) with quick start guide
- **SETUP_GUIDE.md**: Detailed step-by-step instructions
- **PRIVACY.md**: Clear data handling transparency
- **CHANGELOG.md**: Version history and notable changes

### Developer Documentation Update Points
- New AI provider integrations
- Chrome API usage changes
- Breaking changes in configuration
- Security updates or considerations
- Architecture decisions and rationale (See [DESIGN_SPECIFICATIONS.md](docs/DESIGN_SPECIFICATIONS.md))
- i18n: New user-facing documentation requirements

### Localization Notes
- Primary UI language: Japanese
- Documentation: Bilingual Japanese/English
- Code comments: English for consistency
- Error messages: User-friendly, consider localization

### Internationalization (i18n) Guidelines

#### User-Facing Documentation: Bilingual Format (Japanese/English)

All user-facing documentation MUST follow the bilingual structure:

1. **Header Format**:
   - `# {JP Title} / {English Title}`
   - Example: `# PII 機能ガイド / PII Feature Guide`

2. **Navigation Bar** (Required):
   ```markdown
   [日本語](#日本語) | [English](#english)

   ---
   ```

3. **Section Structure**:
   - `## 日本語` と `## English` を並列で配置
   - 各言語内で同じセクションレベル（###, #### 等）を使用
   - コードブロック、JSON例は翻訳せずそのまま保持

4. **Translation Quality Standards**:
   - Technical terms consistency with README.md (e.g., "Privacy mode", "PII masking")
   - Natural and technically accurate English translations
   - Japanese phrases remain in Japanese in specific contexts

#### Documentation Scope

**Requires Bilingual Format** (for User-Facing Docs):
- README.md ✅
- SETUP_GUIDE.md ✅
- PRIVACY.md ✅
- USER-GUIDE-UBLOCK-IMPORT.md ✅
- PII_FEATURE_GUIDE.md ✅
- docs/UBLOCK_MIGRATION.md ✅

**English-Only** (for Developer/Internal Docs):
- AGENTS.md (English only)
- docs/DESIGN_SPECIFICATIONS.md (English only)

**Special Handling**:
- CHANGELOG.md: Historical entries remain as-is; future entries follow bilingual format

#### Best Practices

1. **Reference Implementation**: Use README.md as template
2. **Navigation Links**: Ensure `[日本語](#日本語)` and `[English](#english)` work correctly
3. **Parallel Structure**: Match section hierarchies between Japanese and English
4. **Code Preservation**: Keep code blocks, JSON examples, and technical content untranslated

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

## Agent Coordination Notes

When multiple agents work on this project:
1. **Feature agents** should coordinate with **security agents** when adding new API integrations
2. **Bug fix agents** should consult **documentation agents** for user-impacting fixes
3. **Performance agents** should work with **feature agents** during new feature development
4. **Code review agents** should verify compliance with all relevant agent guidelines
5. All agents should respect the modular architecture and avoid cross-contamination of concerns

## Testing Strategy

### Manual Testing Required
- Chrome extension loading and permissions
- Actual Chrome extension functionality
- Real AI provider API calls
- Obsidian Local REST API integration

### Automated Testing Considerations
- Unit tests for pure utility functions
- Mock API responses for testing error handling
- Content script injection simulation
- Chrome storage API mocking

### Test Environment Setup
1. Chrome browser with Developer Mode enabled
2. Obsidian with Local REST API plugin installed
3. Valid API keys for at least one AI provider
4. Test daily notes directory structure