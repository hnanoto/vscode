/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import type { IMessage } from './baseProvider';
import {
	buildProviderById,
	getCandidateModels,
	getProviderDescriptors,
	type HCodeProviderDescriptor,
	type HCodeProviderId,
} from './providerRegistry';

interface HCodeLanguageModelInformation extends vscode.LanguageModelChatInformation {
	readonly providerId: HCodeProviderId;
}

function inferFamily(modelId: string): string {
	const withoutNamespace = modelId.includes('/') ? modelId.split('/').pop() ?? modelId : modelId;
	return withoutNamespace.split(':')[0] || modelId;
}

function inferVersion(modelId: string): string {
	const datedVersion = modelId.match(/\d{4}-\d{2}-\d{2}/)?.[0];
	return datedVersion ?? 'configured';
}

function flattenPart(part: vscode.LanguageModelInputPart | unknown): string {
	if (part instanceof vscode.LanguageModelTextPart) {
		return part.value;
	}

	if (part instanceof vscode.LanguageModelToolCallPart) {
		return `Tool call: ${part.name}\n${JSON.stringify(part.input, null, 2)}`;
	}

	if (part instanceof vscode.LanguageModelToolResultPart) {
		const content = part.content.map(flattenPart).filter(Boolean).join('\n');
		return `Tool result (${part.callId}):\n${content}`;
	}

	if (part instanceof vscode.LanguageModelDataPart) {
		if (part.mimeType.startsWith('image/')) {
			return `[image:${part.mimeType}:${Buffer.from(part.data).toString('base64')}]`;
		}

		const decoded = new TextDecoder().decode(part.data);
		if (part.mimeType.includes('json')) {
			return `JSON data:\n${decoded}`;
		}
		return decoded;
	}

	return typeof part === 'string' ? part : String(part);
}

function flattenMessage(message: vscode.LanguageModelChatRequestMessage): string {
	return message.content
		.map(flattenPart)
		.filter(Boolean)
		.join('\n')
		.trim();
}

function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

class HCodeLanguageModelChatProvider implements vscode.LanguageModelChatProvider<HCodeLanguageModelInformation>, vscode.Disposable {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();

	readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

	constructor(private readonly descriptor: HCodeProviderDescriptor) { }

	dispose(): void {
		this.onDidChangeEmitter.dispose();
	}

	fireDidChange(): void {
		this.onDidChangeEmitter.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<HCodeLanguageModelInformation[]> {
		const provider = buildProviderById(this.descriptor.id);
		if (!(await provider.isAvailable())) {
			return [];
		}

		const models = await getCandidateModels(this.descriptor);
		return models.map(modelId => ({
			id: modelId,
			name: modelId,
			family: inferFamily(modelId),
			version: inferVersion(modelId),
			maxInputTokens: this.descriptor.maxInputTokens,
			maxOutputTokens: this.descriptor.maxOutputTokens,
			capabilities: this.descriptor.capabilities,
			tooltip: `${this.descriptor.displayName} via HCode AI`,
			detail: 'Configured in HCode AI',
			providerId: this.descriptor.id,
		}));
	}

	async provideLanguageModelChatResponse(
		model: HCodeLanguageModelInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const provider = buildProviderById(model.providerId);
		if (!(await provider.isAvailable())) {
			throw vscode.LanguageModelError.NotFound(`Configure HCode AI provider "${this.descriptor.displayName}" before using this model.`);
		}

		const hcodeMessages: IMessage[] = messages
			.map(message => ({
				role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user',
				content: flattenMessage(message),
			}))
			.filter(message => message.content.length > 0);

		const modelOptions = options.modelOptions;
		const temperature = typeof modelOptions?.temperature === 'number' ? modelOptions.temperature : undefined;
		const maxTokens = typeof modelOptions?.maxTokens === 'number' ? modelOptions.maxTokens : undefined;

		for await (const chunk of provider.chat(hcodeMessages, {
			model: model.id,
			temperature,
			maxTokens,
		}, token)) {
			progress.report(new vscode.LanguageModelTextPart(chunk));
		}
	}

	async provideTokenCount(
		_model: HCodeLanguageModelInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokens(typeof text === 'string' ? text : flattenMessage(text));
	}
}

export function registerNativeLanguageModelProviders(ctx: vscode.ExtensionContext): void {
	const providers = getProviderDescriptors().map(descriptor => {
		const provider = new HCodeLanguageModelChatProvider(descriptor);
		ctx.subscriptions.push(
			provider,
			vscode.lm.registerLanguageModelChatProvider(descriptor.vendor, provider),
		);
		return provider;
	});

	ctx.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration('hcode.ai')) {
				return;
			}

			for (const provider of providers) {
				provider.fireDidChange();
			}
		}),
	);
}
