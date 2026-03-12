/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

/**
 * GitHubModelsProvider — Gratuito para qualquer conta GitHub.
 * Acessa GPT-4o, GPT-4o-mini, Llama 3.3 70B, Phi-4, Mistral, Codestral e mais.
 * Token: https://github.com/settings/tokens (Personal Access Token)
 */
export class GitHubModelsProvider implements IHCodeProvider {
	readonly id = 'github';
	readonly name = 'GitHub Models';
	private readonly endpoint = 'https://models.inference.ai.azure.com/chat/completions';

	constructor(private readonly token: string) { }

	async isAvailable(): Promise<boolean> {
		return this.token.trim().length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: { isCancellationRequested: boolean }): AsyncGenerator<string> {
		const body = {
			model: options.model ?? 'gpt-4o-mini',
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			temperature: options.temperature ?? 0.2,
			max_tokens: options.maxTokens ?? 4096,
			stream: true,
		};

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.token}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`GitHub Models error ${response.status}: ${err}`);
		}

		const reader = response.body?.getReader();
		if (!reader) { throw new Error('No response body from GitHub Models'); }
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
