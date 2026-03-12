/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

/**
 * GrokProvider — LLM da xAI (Elon Musk).
 * API compatível com OpenAI, muito capaz em raciocínio e código.
 * Modelos: grok-3, grok-3-mini (rápido/barato), grok-2
 * API key: https://console.x.ai (gratuita para começar)
 */
export class GrokProvider implements IHCodeProvider {
	readonly id = 'grok';
	readonly name = 'Grok (xAI)';
	private readonly endpoint = 'https://api.x.ai/v1/chat/completions';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.trim().length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: { isCancellationRequested: boolean }): AsyncGenerator<string> {
		const body = {
			model: options.model ?? 'grok-3-mini',
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			temperature: options.temperature ?? 0.2,
			max_tokens: options.maxTokens ?? 131072,
			stream: true,
		};

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`Grok API error ${response.status}: ${err}`);
		}

		const reader = response.body?.getReader();
		if (!reader) { throw new Error('No response body from Grok'); }
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
