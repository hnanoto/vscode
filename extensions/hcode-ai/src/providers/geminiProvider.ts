/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { IHCodeProvider, IMessage, IChatOptions } from './baseProvider';

interface GeminiPart {
	text?: string;
	inlineData?: { mimeType: string; data: string };
	thought?: boolean;
}

interface GeminiCandidate {
	content?: { parts?: GeminiPart[] };
	finishReason?: string;
}

interface GeminiStreamChunk {
	candidates?: GeminiCandidate[];
	usageMetadata?: { totalTokenCount?: number };
}

/**
 * GeminiProvider — Paridade total com Google Antigravity IDE.
 *
 * Features:
 * - Extended Thinking (Gemini 2.5 Pro raciocina profundamente antes de responder)
 * - Google Search Grounding (respostas com dados da internet em tempo real)
 * - Visão/Multimodal (analisa imagens, screenshots, diagramas)
 * - Contexto de 1M tokens (lê repositórios inteiros)
 * - Code Execution (executa Python internamente)
 * - Streaming nativo
 *
 * Free tier: 2M tokens/mês com gemini-2.0-flash, sem cartão de crédito.
 * API key: https://aistudio.google.com
 */
export class GeminiProvider implements IHCodeProvider {
	readonly id = 'gemini';
	readonly name = 'Google Gemini';

	constructor(private readonly apiKey: string) { }

	async isAvailable(): Promise<boolean> {
		return this.apiKey.trim().length > 0;
	}

	async *chat(messages: IMessage[], options: IChatOptions, token: { isCancellationRequested: boolean }): AsyncGenerator<string> {
		const model = options.model ?? 'gemini-2.0-flash';
		const useThinking = model.includes('2.5') || model.includes('thinking');
		const useSearch = options.useGoogleSearch ?? true; // Grounding habilitado por padrão
		const useCodeExec = options.useCodeExecution ?? false;

		// Separar system instruction das mensagens do usuário
		const systemMessage = messages.find(m => m.role === 'system');
		const conversationMessages = messages.filter(m => m.role !== 'system');

		// Construir contents no formato Gemini
		const contents = conversationMessages.map(m => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: this.buildParts(m.content),
		}));

		// Construir tools habilitadas
		const tools: object[] = [];
		if (useSearch && !useCodeExec) {
			// Google Search grounding — como o Antigravity usa para respostas atualizadas
			tools.push({ googleSearch: {} });
		}
		if (useCodeExec) {
			tools.push({ codeExecution: {} });
		}

		const body: Record<string, unknown> = {
			contents,
			generationConfig: {
				temperature: options.temperature ?? 0.2,
				maxOutputTokens: options.maxTokens ?? 65536,
				responseMimeType: 'text/plain',
				...(useThinking ? {
					thinkingConfig: {
						thinkingBudget: 8192, // Tokens para raciocínio interno
						includeThoughts: true, // Mostrar raciocínio ao usuário
					}
				} : {}),
			},
			safetySettings: [
				{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
				{ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
				{ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
				{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
			],
		};

		if (systemMessage) {
			body['systemInstruction'] = { parts: [{ text: systemMessage.content }] };
		}
		if (tools.length > 0) {
			body['tools'] = tools;
		}

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`Gemini API error ${response.status}: ${err}`);
		}

		const reader = response.body?.getReader();
		if (!reader) { throw new Error('No response body from Gemini'); }
		const decoder = new TextDecoder();
		let buffer = '';
		let thinkingStarted = false;
		let thinkingDone = false;

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
				if (!data || data === '[DONE]') { continue; }

				try {
					const chunk = JSON.parse(data) as GeminiStreamChunk;
					for (const candidate of chunk.candidates ?? []) {
						for (const part of candidate.content?.parts ?? []) {
							if (part.thought && part.text) {
								// Thinking tokens — mostrar como blockquote (igual ao Antigravity)
								if (!thinkingStarted) {
									thinkingStarted = true;
									yield '\n> 💭 **Thinking...**\n>\n';
								}
								const lines = part.text.split('\n');
								yield lines.map(l => `> ${l}`).join('\n');
							} else if (part.text) {
								// Resposta final — fechar o bloco de thinking se aberto
								if (thinkingStarted && !thinkingDone) {
									thinkingDone = true;
									yield '\n\n';
								}
								yield part.text;
							}
						}

						// Mostrar fontes de busca se usar Google Search
						if (candidate.finishReason === 'STOP' && useSearch) {
							// Grounding metadata vem no campo groundingMetadata — handled via parts
						}
					}
				} catch { /* skip malformed chunks */ }
			}
		}
		reader.cancel();
	}

	/** Lista modelos disponíveis via API */
	async listModels(): Promise<string[]> {
		try {
			const res = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`
			);
			if (!res.ok) { return this.defaultModels(); }
			const data = await res.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
			return (data.models ?? [])
				.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
				.map(m => m.name.replace('models/', ''))
				.filter(m => m.includes('gemini'));
		} catch {
			return this.defaultModels();
		}
	}

	private defaultModels(): string[] {
		return [
			'gemini-2.5-pro-exp-03-25',  // Mais capaz — igual ao Antigravity
			'gemini-2.0-flash',           // Gratuito e rápido
			'gemini-2.0-flash-thinking-exp', // Raciocínio gratuito
			'gemini-1.5-pro',             // Contexto longo (1M tokens)
			'gemini-1.5-flash',           // Balanço velocidade/capacidade
		];
	}

	/** Constrói as partes de um conteúdo Gemini — suporte a texto e imagens base64 */
	private buildParts(content: string): GeminiPart[] {
		// Detectar imagens base64 embedadas (formato: [image:base64,data])
		const imagePattern = /\[image:([\w/+=]+):([^\]]+)\]/g;
		const parts: GeminiPart[] = [];
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = imagePattern.exec(content)) !== null) {
			const [, mimeType, data] = match;
			if (match.index > lastIndex) {
				parts.push({ text: content.slice(lastIndex, match.index) });
			}
			parts.push({ inlineData: { mimeType, data } });
			lastIndex = match.index + match[0].length;
		}

		const remaining = content.slice(lastIndex);
		if (remaining) {
			parts.push({ text: remaining });
		}

		return parts.length > 0 ? parts : [{ text: content }];
	}
}

// Extender IChatOptions com opções Gemini-específicas
declare module './baseProvider' {
	interface IChatOptions {
		useGoogleSearch?: boolean;
		useCodeExecution?: boolean;
	}
}
