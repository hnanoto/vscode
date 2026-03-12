/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

/**
 * DeepSeekProvider — Excelente para programação. Tier gratuito generoso.
 * Free tier: $5 de crédito ao criar conta, DeepSeek-V3 muito barato
 * Modelos: deepseek-chat (V3), deepseek-reasoner (R1 com chain-of-thought)
 * API key: https://platform.deepseek.com (gratuita para começar)
 */
export class DeepSeekProvider implements IHCodeProvider {
	readonly id = 'deepseek';
	readonly name = 'DeepSeek';
	private readonly endpoint = 'https://api.deepseek.com/v1/chat/completions';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.trim().length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: { isCancellationRequested: boolean }): AsyncGenerator<string> {
		const model = options.model ?? 'deepseek-chat';
		const isReasoner = model.includes('reasoner');

		// DeepSeek-R1 (reasoner) uses special thinking tokens
		const body: Record<string, unknown> = {
			model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			temperature: isReasoner ? 1 : (options.temperature ?? 0.2),
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
			throw new Error(`DeepSeek API error ${response.status}: ${err}`);
		}

		const reader = response.body?.getReader();
		if (!reader) { throw new Error('No response body from DeepSeek'); }
		const decoder = new TextDecoder();
		let buffer = '';
		let inThinking = false;

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
					const delta = json.choices?.[0]?.delta;
					if (!delta) { continue; }

					// Handle reasoning_content (R1 thinking) — show as blockquote
					if (delta.reasoning_content && !inThinking) {
						inThinking = true;
						yield '\n> 💭 *Thinking...*\n> ';
					}
					if (delta.reasoning_content) {
						yield delta.reasoning_content.replace(/\n/g, '\n> ');
					}
					if (delta.content) {
						if (inThinking) {
							inThinking = false;
							yield '\n\n';
						}
						yield delta.content;
					}
				} catch { /* skip */ }
			}
		}
		reader.cancel();
	}
}
