/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

/**
 * GroqProvider — Ultra-rápido, gratuito para uso pessoal.
 * Free tier: ~14.400 req/dia, 30 req/min
 * Modelos: llama-3.3-70b-versatile, mixtral-8x7b-32768, gemma2-9b-it
 * API key: https://console.groq.com (gratuita)
 */
export class GroqProvider implements IHCodeProvider {
	readonly id = 'groq';
	readonly name = 'Groq';
	private readonly endpoint = 'https://api.groq.com/openai/v1/chat/completions';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.trim().length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: { isCancellationRequested: boolean }): AsyncGenerator<string> {
		const body = {
			model: options.model ?? 'llama-3.3-70b-versatile',
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			temperature: options.temperature ?? 0.2,
			max_tokens: options.maxTokens ?? 8192,
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
			throw new Error(`Groq API error ${response.status}: ${err}`);
		}

		const reader = response.body?.getReader();
		if (!reader) { throw new Error('No response body from Groq'); }
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
