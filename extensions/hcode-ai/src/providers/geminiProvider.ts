/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

interface GeminiResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	error?: { message: string; code: number };
}

/**
 * Google Gemini provider.
 * Free tier available at https://aistudio.google.com
 * Supports gemini-2.0-flash (free), gemini-2.5-pro-exp, gemini-1.5-pro and more.
 */
export class GeminiProvider implements IHCodeProvider {
	readonly id = 'gemini';
	readonly name = 'Google Gemini';

	private static readonly BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: vscode.CancellationToken): AsyncIterable<string> {
		const controller = new AbortController();
		const dispose = token.onCancellationRequested(() => controller.abort());

		// Separate system prompt from conversation
		const systemMessage = messages.find(m => m.role === 'system');
		const conversationMessages = messages.filter(m => m.role !== 'system');

		const body = {
			...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
			contents: conversationMessages.map(m => ({
				role: m.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: m.content }],
			})),
			generationConfig: {
				temperature: options.temperature ?? 0.2,
				maxOutputTokens: options.maxTokens ?? 8192,
			},
		};

		try {
			const url = `${GeminiProvider.BASE_URL}/models/${options.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			if (!res.ok) {
				const err = await res.json() as GeminiResponse;
				throw new Error(`Gemini error ${res.status}: ${err.error?.message ?? 'Unknown error'}`);
			}

			const reader = res.body?.getReader();
			if (!reader) { throw new Error('No response body from Gemini'); }

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
						const chunk: GeminiResponse = JSON.parse(payload);
						const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
						if (text) {
							yield text;
						}
					} catch {
						// Skip malformed SSE lines
					}
				}
			}
		} finally {
			dispose.dispose();
		}
	}
}
