import { sanitizeForObsidian } from '../src/utils/markdownSanitizer.js';

for (const s of ['!![a](b)', '[[[a](https://x)]]', '[a[b](https://x)', '![[a]]', '!![[a]]']) {
    console.log(JSON.stringify(s), '=>', JSON.stringify(sanitizeForObsidian(s)));
}
