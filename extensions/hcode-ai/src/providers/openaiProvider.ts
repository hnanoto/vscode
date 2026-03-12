/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

interface OpenAIChunk {
	choices?: Array<{
		delta?: { content?: string };
		finish_reason?: string;
	}>;
	error?: { message: string };
}

/**
 * OpenAI-compatible provider.
 * Works with OpenAI (GPT-4o, Codex), Groq, Together AI, Anyscale,
 * LM Studio, and any other OpenAI-compatible API.
 * Get a key at https://platform.openai.com
 */
export class OpenAIProvider implements IHCodeProvider {
	readonly id = 'openai';
	readonly name: string;

	constructor(
		private readonly apiKey: string,
		private readonly endpoint: string,
	) {
		// Detect provider from endpoint for display name
		if (endpoint.includes('groq.com')) {
			this.name = 'Groq';
		} else if (endpoint.includes('together.xyz')) {
			this.name = 'Together AI';
		} else if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) {
			this.name = 'Local OpenAI-compatible';
		} else {
			this.name = 'OpenAI / Codex';
		}
	}

	async isAvailable(): Promise<boolean> {
		return this.apiKey.length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: vscode.CancellationToken): AsyncIterable<string> {
		const controller = new AbortController();
		const dispose = token.onCancellationRequested(() => controller.abort());

		try {
			const res = await fetch(`${this.endpoint}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: options.model,
					messages,
					stream: true,
					temperature: options.temperature ?? 0.2,
					max_tokens: options.maxTokens ?? 8192,
				}),
				signal: controller.signal,
			});

			if (!res.ok) {
				const err = await res.json() as OpenAIChunk;
				throw new Error(`OpenAI error ${res.status}: ${err.error?.message ?? res.statusText}`);
			}

			const reader = res.body?.getReader();
			if (!reader) { throw new Error('No response body from OpenAI API'); }

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
					if (payload === '[DONE]') { return; }
					try {
						const chunk: OpenAIChunk = JSON.parse(payload);
						const text = chunk.choices?.[0]?.delta?.content;
						if (text) {
							yield text;
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
