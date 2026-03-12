/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

/**
 * OpenRouterProvider — Gateway para 200+ modelos, muitos gratuitos.
 * Modelos gratuitos: meta-llama/llama-3.3-70b-instruct:free,
 *   deepseek/deepseek-r1:free, google/gemma-3-27b-it:free,
 *   mistralai/mistral-7b-instruct:free, qwen/qwen-2.5-coder-32b-instruct:free
 * API key: https://openrouter.ai/keys (gratuita, sem cartão)
 */
export class OpenRouterProvider implements IHCodeProvider {
	readonly id = 'openrouter';
	readonly name = 'OpenRouter';
	private readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.trim().length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: { isCancellationRequested: boolean }): AsyncGenerator<string> {
		// Filter out system messages if model doesn't support — OpenRouter handles this
		const filteredMessages = messages.map(m => ({ role: m.role, content: m.content }));

		const body = {
			model: options.model ?? 'qwen/qwen-2.5-coder-32b-instruct:free',
			messages: filteredMessages,
			temperature: options.temperature ?? 0.2,
			max_tokens: options.maxTokens ?? 8192,
			stream: true,
		};

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
				'HTTP-Referer': 'https://github.com/hnanoto/vscode',
				'X-Title': 'HCode AI',
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`OpenRouter error ${response.status}: ${err}`);
		}

		const reader = response.body?.getReader();
		if (!reader) { throw new Error('No response body from OpenRouter'); }
		const decoder = new TextDecoder();
		let buffer = '';

		while (!token.isCancellationRequested) {
			const { done, value } = await reader.read();
			if (done) { break; }
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data: ')) { continue; }
				const data = trimmed.slice(6);
				if (data === '[DONE]') { return; }
				try {
					const json = JSON.parse(data);
					const content = json.choices?.[0]?.delta?.content;
					if (content) { yield content; }
				} catch { /* skip */ }
			}
		}
		reader.cancel();
	}
}
