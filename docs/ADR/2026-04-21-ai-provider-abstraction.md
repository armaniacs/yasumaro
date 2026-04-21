# ADR-015: AI Provider Abstraction Architecture

## Status

**Complete** - AI Provider abstraction already exists in the codebase.

## Context

Goal: Make adding new AI providers plug-and-play, with changes limited to 5 files or less.

## Decision

The codebase already implements a Strategy Pattern for AI providers:

### Architecture

```
aiClient.ts (Factory Pattern)
    │
    ├── registerProvider(name, factory)
    │
    └── getProvider(name) → AIProviderStrategy

AIProviderStrategy (Abstract Class)
    │
    ├── generateSummary(content, tagSummaryMode?)
    ├── testConnection()
    ├── getName()
    └── getProviderId()
```

### Current Providers (6)

| Provider ID | Class | Use Case |
|------------|-------|----------|
| `gemini` | GeminiProvider | Google Gemini API |
| `openai` | OpenAIProvider | OpenAI API |
| `openai2` | OpenAIProvider | OpenAI-compatible APIs |
| `lm-studio` | OpenAIProvider | LM Studio |
| `ollama` | OpenAIProvider | Ollama |
| `openai-compatible` | OpenAIProvider | Any OpenAI-compatible API |

### Adding a New Provider

**Step 1: Create provider class (optional if using OpenAI-compatible)**

For OpenAI-compatible APIs, simply use `OpenAIProvider`:
```typescript
// No new file needed - just register in aiClient.ts
this.registerProvider('new-provider', (settings) => 
  new OpenAIProvider(settings, 'new-provider'));
```

For custom APIs, extend `AIProviderStrategy`:
```typescript
// src/background/ai/providers/CustomProvider.ts
import { AIProviderStrategy } from './ProviderStrategy.js';

export class CustomProvider extends AIProviderStrategy {
  async generateSummary(content: string): Promise<AISummaryResult> {
    // Implementation
  }
  
  async testConnection(): Promise<AIProviderConnectionResult> {
    // Implementation
  }
  
  getName(): string {
    return 'custom';
  }
}
```

**Step 2: Register in aiClient.ts**

```typescript
// src/background/aiClient.ts
registerDefaultProviders(): void {
  // Existing providers...
  this.registerProvider('custom', (settings) => new CustomProvider(settings));
}
```

### File Changes Summary

| Change | Files Modified |
|--------|---------------|
| OpenAI-compatible | 1 (aiClient.ts) |
| Custom provider | 1-2 (new provider class + aiClient.ts) |

**Target achieved: ≤ 5 files**

## References

- `src/background/aiClient.ts` - Provider factory
- `src/background/ai/providers/ProviderStrategy.ts` - Base class
- `src/background/ai/providers/GeminiProvider.ts` - Custom provider example
- `src/background/ai/providers/OpenAIProvider.ts` - OpenAI-compatible example