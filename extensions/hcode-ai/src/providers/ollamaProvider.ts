/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

interface OllamaChunk {
	message?: { content?: string };
	done?: boolean;
	error?: string;
}

/**
 * Ollama provider — runs AI models 100% locally with full privacy.
 * No internet required. Supports codellama, deepseek-coder, qwen2.5-coder, phi4 and more.
 * Install Ollama from https://ollama.ai
 */
export class OllamaProvider implements IHCodeProvider {
	readonly id = 'ollama';
	readonly name = 'Ollama (Local)';

	constructor(private readonly endpoint: string) { }

	async isAvailable(): Promise<boolean> {
		try {
			const res = await fetch(`${this.endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
			return res.ok;
		} catch {
			return false;
		}
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: vscode.CancellationToken): AsyncIterable<string> {
		const controller = new AbortController();
		const dispose = token.onCancellationRequested(() => controller.abort());

		try {
			const res = await fetch(`${this.endpoint}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: options.model,
					messages,
					stream: true,
					options: {
						temperature: options.temperature ?? 0.2,
						num_predict: options.maxTokens ?? 8192,
					}
				}),
				signal: controller.signal,
			});

			if (!res.ok) {
				const err = await res.text();
				throw new Error(`Ollama error ${res.status}: ${err}`);
			}

			const reader = res.body?.getReader();
			if (!reader) {
				throw new Error('No response body from Ollama');
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.trim()) { continue; }
					try {
						const chunk: OllamaChunk = JSON.parse(line);
						if (chunk.error) {
							throw new Error(`Ollama: ${chunk.error}`);
						}
						const text = chunk.message?.content;
						if (text) {
							yield text;
						}
						if (chunk.done) {
							return;
						}
					} catch (e) {
						if (e instanceof SyntaxError) { continue; }
						throw e;
					}
				}
			}
		} finally {
			dispose.dispose();
		}
	}

	/** Lists all locally installed Ollama models */
	async listModels(): Promise<string[]> {
		try {
			const res = await fetch(`${this.endpoint}/api/tags`);
			if (!res.ok) { return []; }
			const data = await res.json() as { models?: Array<{ name: string }> };
			return (data.models ?? []).map(m => m.name);
		} catch {
			return [];
		}
	}
}
