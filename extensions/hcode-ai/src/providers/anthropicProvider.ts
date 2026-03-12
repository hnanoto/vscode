/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

interface AnthropicChunk {
	type: string;
	delta?: { type?: string; text?: string };
	error?: { message: string };
}

/**
 * Anthropic Claude provider.
 * Supports Claude Opus, Sonnet, Haiku and Claude 3.7 with extended thinking.
 * Get a key at https://console.anthropic.com
 */
export class AnthropicProvider implements IHCodeProvider {
	readonly id = 'anthropic';
	readonly name = 'Anthropic Claude';

	private static readonly BASE_URL = 'https://api.anthropic.com/v1';
	private static readonly API_VERSION = '2023-06-01';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: vscode.CancellationToken): AsyncIterable<string> {
		const controller = new AbortController();
		const dispose = token.onCancellationRequested(() => controller.abort());

		// Anthropic separates system message from messages array
		const systemMsg = messages.find(m => m.role === 'system')?.content;
		const conversationMessages = messages
			.filter(m => m.role !== 'system')
			.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

		try {
			const res = await fetch(`${AnthropicProvider.BASE_URL}/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.apiKey,
					'anthropic-version': AnthropicProvider.API_VERSION,
					'anthropic-beta': 'interleaved-thinking-2025-05-14',
				},
				body: JSON.stringify({
					model: options.model,
					messages: conversationMessages,
					...(systemMsg ? { system: systemMsg } : {}),
					stream: true,
					max_tokens: options.maxTokens ?? 8192,
					temperature: options.temperature ?? 0.2,
				}),
				signal: controller.signal,
			});

			if (!res.ok) {
				const err = await res.json() as AnthropicChunk;
				throw new Error(`Anthropic error ${res.status}: ${err.error?.message ?? res.statusText}`);
			}

			const reader = res.body?.getReader();
			if (!reader) { throw new Error('No response body from Anthropic'); }

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) { continue; }
					const payload = line.slice(6).trim();
					try {
						const chunk: AnthropicChunk = JSON.parse(payload);
						// Only yield actual text deltas, skip thinking blocks
						if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
							const text = chunk.delta.text;
							if (text) {
								yield text;
							}
						}
					} catch {
						// Skip malformed SSE chunks
					}
				}
			}
		} finally {
			dispose.dispose();
		}
	}
}
