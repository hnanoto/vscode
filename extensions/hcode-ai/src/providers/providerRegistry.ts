/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { AnthropicProvider } from './anthropicProvider';
import type { IHCodeProvider } from './baseProvider';
import { DeepSeekProvider } from './deepseekProvider';
import { GeminiProvider } from './geminiProvider';
import { GitHubModelsProvider } from './githubModelsProvider';
import { GrokProvider } from './grokProvider';
import { GroqProvider } from './groqProvider';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';
import { OpenRouterProvider } from './openrouterProvider';

export type HCodeProviderId =
	| 'ollama'
	| 'gemini'
	| 'groq'
	| 'github'
	| 'openrouter'
	| 'deepseek'
	| 'openai'
	| 'anthropic'
	| 'grok';

export type HCodeLanguageModelVendor = `hcode-${HCodeProviderId}`;

type ProviderWithOptionalModelList = IHCodeProvider & Partial<{
	listModels(): Promise<string[]>;
}>;

export interface HCodeProviderDescriptor {
	readonly id: HCodeProviderId;
	readonly vendor: HCodeLanguageModelVendor;
	readonly displayName: string;
	readonly getConfiguredModel: () => string;
	readonly buildProvider: () => ProviderWithOptionalModelList;
	readonly defaults: readonly string[];
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly capabilities: vscode.LanguageModelChatCapabilities;
}

function cfg<T>(key: string): T {
	return vscode.workspace.getConfiguration('hcode.ai').get<T>(key) as T;
}

function uniqueStrings(values: Iterable<string>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}

	return result;
}

const PROVIDER_DESCRIPTORS: Record<HCodeProviderId, HCodeProviderDescriptor> = {
	ollama: {
		id: 'ollama',
		vendor: 'hcode-ollama',
		displayName: 'Ollama (Local)',
		getConfiguredModel: () => cfg<string>('ollama.model'),
		buildProvider: () => new OllamaProvider(cfg<string>('ollama.endpoint')),
		defaults: ['qwen2.5-coder:7b', 'deepseek-coder:6.7b', 'llama3.3', 'phi4:14b'],
		maxInputTokens: 128_000,
		maxOutputTokens: 8_192,
		capabilities: {},
	},
	gemini: {
		id: 'gemini',
		vendor: 'hcode-gemini',
		displayName: 'Google Gemini',
		getConfiguredModel: () => cfg<string>('gemini.model'),
		buildProvider: () => new GeminiProvider(cfg<string>('gemini.apiKey')),
		defaults: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'],
		maxInputTokens: 1_048_576,
		maxOutputTokens: 65_536,
		capabilities: {
			imageInput: true,
		},
	},
	groq: {
		id: 'groq',
		vendor: 'hcode-groq',
		displayName: 'Groq',
		getConfiguredModel: () => cfg<string>('groq.model'),
		buildProvider: () => new GroqProvider(cfg<string>('groq.apiKey')),
		defaults: ['qwen/qwen3-32b', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'],
		maxInputTokens: 131_072,
		maxOutputTokens: 8_192,
		capabilities: {},
	},
	github: {
		id: 'github',
		vendor: 'hcode-github',
		displayName: 'GitHub Models',
		getConfiguredModel: () => cfg<string>('github.model'),
		buildProvider: () => new GitHubModelsProvider(cfg<string>('github.token')),
		defaults: ['gpt-4o-mini', 'gpt-4o', 'Phi-4', 'Meta-Llama-3.3-70B-Instruct'],
		maxInputTokens: 128_000,
		maxOutputTokens: 4_096,
		capabilities: {},
	},
	openrouter: {
		id: 'openrouter',
		vendor: 'hcode-openrouter',
		displayName: 'OpenRouter',
		getConfiguredModel: () => cfg<string>('openrouter.model'),
		buildProvider: () => new OpenRouterProvider(cfg<string>('openrouter.apiKey')),
		defaults: ['openrouter/free', 'qwen/qwen-2.5-coder-32b-instruct:free', 'deepseek/deepseek-r1:free', 'microsoft/phi-4:free'],
		maxInputTokens: 128_000,
		maxOutputTokens: 8_192,
		capabilities: {},
	},
	deepseek: {
		id: 'deepseek',
		vendor: 'hcode-deepseek',
		displayName: 'DeepSeek',
		getConfiguredModel: () => cfg<string>('deepseek.model'),
		buildProvider: () => new DeepSeekProvider(cfg<string>('deepseek.apiKey')),
		defaults: ['deepseek-chat', 'deepseek-reasoner'],
		maxInputTokens: 64_000,
		maxOutputTokens: 8_192,
		capabilities: {},
	},
	openai: {
		id: 'openai',
		vendor: 'hcode-openai',
		displayName: 'OpenAI / Codex',
		getConfiguredModel: () => cfg<string>('openai.model'),
		buildProvider: () => new OpenAIProvider(cfg<string>('openai.apiKey'), cfg<string>('openai.endpoint')),
		defaults: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'codex-mini-latest'],
		maxInputTokens: 128_000,
		maxOutputTokens: 16_384,
		capabilities: {},
	},
	anthropic: {
		id: 'anthropic',
		vendor: 'hcode-anthropic',
		displayName: 'Anthropic Claude',
		getConfiguredModel: () => cfg<string>('anthropic.model'),
		buildProvider: () => new AnthropicProvider(cfg<string>('anthropic.apiKey')),
		defaults: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
		maxInputTokens: 200_000,
		maxOutputTokens: 8_192,
		capabilities: {},
	},
	grok: {
		id: 'grok',
		vendor: 'hcode-grok',
		displayName: 'Grok (xAI)',
		getConfiguredModel: () => cfg<string>('grok.model'),
		buildProvider: () => new GrokProvider(cfg<string>('grok.apiKey')),
		defaults: ['grok-4', 'grok-3', 'grok-3-mini'],
		maxInputTokens: 131_072,
		maxOutputTokens: 16_384,
		capabilities: {},
	},
};

export function getProviderDescriptors(): readonly HCodeProviderDescriptor[] {
	return Object.values(PROVIDER_DESCRIPTORS);
}

export function getProviderDescriptor(id: HCodeProviderId): HCodeProviderDescriptor {
	return PROVIDER_DESCRIPTORS[id];
}

export function getProviderDescriptorByVendor(vendor: string): HCodeProviderDescriptor | undefined {
	return getProviderDescriptors().find(descriptor => descriptor.vendor === vendor);
}

export function getProviderDisplayName(vendor: string): string | undefined {
	return getProviderDescriptorByVendor(vendor)?.displayName;
}

export function getConfiguredProviderId(): HCodeProviderId {
	return cfg<HCodeProviderId>('provider') ?? 'ollama';
}

export function getConfiguredModel(): string {
	return getProviderDescriptor(getConfiguredProviderId()).getConfiguredModel();
}

export function buildProviderById(id: HCodeProviderId): ProviderWithOptionalModelList {
	return getProviderDescriptor(id).buildProvider();
}

export function buildConfiguredProvider(): IHCodeProvider {
	return buildProviderById(getConfiguredProviderId());
}

export async function getCandidateModels(descriptor: HCodeProviderDescriptor): Promise<string[]> {
	const provider = descriptor.buildProvider();
	const dynamicModels = typeof provider.listModels === 'function'
		? await provider.listModels()
		: [];

	return uniqueStrings([
		descriptor.getConfiguredModel(),
		...dynamicModels,
		...descriptor.defaults,
	]);
}
