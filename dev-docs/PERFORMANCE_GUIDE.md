# Performance Guide

> Performance metrics, optimization targets, and browser compatibility for the extension. Referenced from [AGENTS.md](../AGENTS.md).

## Key Metrics

- Content script injection speed
- API response times for AI summarization
- Obsidian write operation frequency
- Memory usage in service worker
- Popup UI responsiveness

## Optimization Targets

1. **Content Extraction**: Efficient DOM parsing, minimal impact on page load
2. **API Calls**: Implement request queuing, respect rate limits
3. **Storage**: Efficient Chrome storage usage, batch operations
4. **Message Passing**: Minimize chrome.runtime.sendMessage overhead
5. **Error Recovery**: Fast fallback mechanisms for failed requests

## Browser Compatibility

- Focus on modern Chrome/Chromium browsers
- Test with latest Chrome version
- Consider Manifest V3 requirements
- Account for service worker lifecycle limitations
