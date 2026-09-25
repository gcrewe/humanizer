import { Actor } from 'apify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await Actor.init();

const input = await Actor.getInput();

if (!input?.text || !String(input.text).trim()) {
    await Actor.fail('Input field "text" is required. Paste the AI-sounding text you want humanized.');
}

const skillMarkdown = readFileSync(join(__dirname, '..', 'SKILL.md'), 'utf8');
const systemPrompt = skillMarkdown.replace(/^---\s*[\s\S]*?---\s*/m, '').trim();

const text = String(input.text).trim();
const voiceSample = input.voiceSample ? String(input.voiceSample).trim() : '';
const model = String(input.model || 'openai/gpt-5.4-mini').trim();
const baseUrl = String(input.baseUrl || 'https://openrouter.apify.actor/api/v1').trim().replace(/\/+$/, '');
const temperature = typeof input.temperature === 'number' ? input.temperature : 0.7;

// The Apify OpenRouter proxy bills the Apify account and authenticates with the
// platform-injected APIFY_TOKEN. An input apiKey overrides it for other providers.
const apiKey = input.apiKey ? String(input.apiKey).trim() : process.env.APIFY_TOKEN;

if (!apiKey) {
    await Actor.fail('No API key available. Run on the Apify platform (APIFY_TOKEN is provided automatically) or set the "apiKey" input for another OpenAI-compatible provider.');
}

let userPrompt = `Humanize this text:\n\n${text}`;
if (voiceSample) {
    userPrompt += `\n\nHere is a sample of my writing for voice matching:\n\n${voiceSample}`;
}
userPrompt += `
\nReturn your answer in three sections, exactly like this:

DRAFT:
<your first rewrite>

REMAINING TELLS:
<short list of patterns that still sound AI-generated, or "none">

FINAL:
<the final rewrite>`;

const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
        model,
        temperature,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    }),
});

if (!response.ok) {
    const body = await response.text();
    await Actor.fail(
        `LLM API request failed with status ${response.status}: ${body.slice(0, 800)}`,
    );
}

const completion = await response.json();
const content = completion?.choices?.[0]?.message?.content;

if (!content) {
    await Actor.fail('LLM API returned no content. Check the model name and baseUrl, or try again.');
}

const draftMatch = content.match(/DRAFT:\s*([\s\S]*?)(?=\n\s*REMAINING TELLS:)/i);
const remainingMatch = content.match(/REMAINING TELLS:\s*([\s\S]*?)(?=\n\s*FINAL:)/i);
const finalMatch = content.match(/FINAL:\s*([\s\S]*)$/i);

const draft = draftMatch?.[1]?.trim() ?? null;
const remainingTells = remainingMatch?.[1]?.trim() ?? null;
const humanizedText = finalMatch?.[1]?.trim() ?? content.trim();

await Actor.pushData({
    humanizedText,
    draft,
    remainingTells,
    model,
    inputCharacters: text.length,
    outputCharacters: humanizedText.length,
});

await Actor.exit();
