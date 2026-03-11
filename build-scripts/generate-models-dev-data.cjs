#!/usr/bin/env node

/**
 * generate-models-dev-data.cjs
 * Generate models.dev provider data for Obsidian Weave
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'https://models.dev/api.json';
const OUTPUT_FILE = path.join(__dirname, '../data/models-dev-openai-compatible.json');

async function main() {
    console.log('Fetching models.dev data...');

    const response = await fetch(API_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const providerKeys = Object.keys(data);
    console.log(`Fetched ${providerKeys.length} providers`);

    // Process providers - filter for OpenAI-compatible packages
    const providers = [];
    const aggregatorsIds = new Set(['openrouter', 'groq', 'perplexity', 'anthropic', 'cohere', 'mistral']);

    for (const providerId of providerKeys) {
        const pkg = data[providerId];

        // Check if package is OpenAI-compatible
        const npmPkg = pkg.npm;
        const isOpenAICompatible = npmPkg === '@ai-sdk/openai-compatible' || npmPkg === '@openrouter/ai-sdk-provider';

        if (!isOpenAICompatible) {
            continue;
        }

        // Build provider object
        const provider = {
            id: providerId,
            name: pkg.name,
            api: pkg.api || '',
            env: pkg.env || [],
            doc: pkg.doc || '',
            isAggregator: aggregatorsIds.has(providerId.toLowerCase()) || pkg.provider === 'aggregators',
            models: []
        };

        // Extract models from models object
        const modelsObj = pkg.models || {};
        const modelEntries = Object.entries(modelsObj);

        for (const [modelId, model] of modelEntries) {
            const inputPrice = model.cost?.input || null;
            const outputPrice = model.cost?.output || null;
            const contextLimit = model.limit?.context || 128000;

            provider.models.push({
                id: modelId,
                name: model.name || modelId,
                contextLimit,
                inputPrice,
                outputPrice,
                isFreeTier: !inputPrice && !outputPrice
            });
        }

        // Sort models
        provider.models.sort((a, b) => a.name.localeCompare(b.name));

        providers.push(provider);
    }

    console.log(`Found ${providers.length} OpenAI-compatible providers`);

    // Final sort
    providers.sort((a, b) => {
        if (a.isAggregator && !b.isAggregator) return -1;
        if (!a.isAggregator && b.isAggregator) return 1;
        return b.models.length - a.models.length;
    });

    // Generate stats
    let totalModels = 0;
    let aggregatorModels = 0;

    providers.forEach(p => {
        totalModels += p.models.length;
        if (p.isAggregator) aggregatorModels += p.models.length;
    });

    const result = {
        generatedAt: new Date().toISOString(),
        providers,
        stats: {
            totalProviders: providers.length,
            totalModels,
            aggregatorProviders: providers.filter(p => p.isAggregator).length,
            aggregatorModels
        }
    };

    console.log(`Processed ${result.stats.totalProviders} providers, ${totalModels} models`);

    // Write output file
    const outputPath = path.resolve(OUTPUT_FILE);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`Saved to: ${outputPath}`);
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});