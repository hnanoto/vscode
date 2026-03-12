/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { OllamaProvider } from './providers/ollamaProvider';
import { GeminiProvider } from './providers/geminiProvider';
import { OpenAIProvider } from './providers/openaiProvider';
import { AnthropicProvider } from './providers/anthropicProvider';
import { GroqProvider } from './providers/groqProvider';
import { DeepSeekProvider } from './providers/deepseekProvider';
import { GitHubModelsProvider } from './providers/githubModelsProvider';
import { OpenRouterProvider } from './providers/openrouterProvider';
import { GrokProvider } from './providers/grokProvider';
import type { IHCodeProvider } from './providers/baseProvider';
import { WorkspaceMemory } from './memory/workspaceMemory';
import { HCodeAIStatusBar } from './ui/statusBar';
import { HCodeAgent, HCODE_PARTICIPANT_ID } from './agent/hcodeAgent';
import {
	ReadFileTool,
	ListDirectoryTool,
	RunTerminalTool,
	SearchCodeTool,
	GitStatusTool,
	DiagnosticsTool,
} from './tools/agenticTools';
import { WebSearchTool, InlineEditTool, CreateFileTool } from './tools/advancedTools';

let provider: IHCodeProvider | undefined;
let currentModel = '';
let memory: WorkspaceMemory | undefined;
let statusBar: HCodeAIStatusBar | undefined;

function cfg<T>(key: string): T {
	return vscode.workspace.getConfiguration('hcode.ai').get<T>(key) as T;
}

/** Builds the active provider from current settings. */
function buildProvider(): IHCodeProvider {
	const providerName = cfg<string>('provider');
	switch (providerName) {
		case 'gemini':
			currentModel = cfg<string>('gemini.model');
			return new GeminiProvider(cfg<string>('gemini.apiKey'));
		case 'openai':
			currentModel = cfg<string>('openai.model');
			return new OpenAIProvider(cfg<string>('openai.apiKey'), cfg<string>('openai.endpoint'));
		case 'anthropic':
			currentModel = cfg<string>('anthropic.model');
			return new AnthropicProvider(cfg<string>('anthropic.apiKey'));
		case 'groq':
			currentModel = cfg<string>('groq.model');
			return new GroqProvider(cfg<string>('groq.apiKey'));
		case 'deepseek':
			currentModel = cfg<string>('deepseek.model');
			return new DeepSeekProvider(cfg<string>('deepseek.apiKey'));
		case 'github':
			currentModel = cfg<string>('github.model');
			return new GitHubModelsProvider(cfg<string>('github.token'));
		case 'openrouter':
			currentModel = cfg<string>('openrouter.model');
			return new OpenRouterProvider(cfg<string>('openrouter.apiKey'));
		case 'grok':
			currentModel = cfg<string>('grok.model');
			return new GrokProvider(cfg<string>('grok.apiKey'));
		case 'ollama':
		default:
			currentModel = cfg<string>('ollama.model');
			return new OllamaProvider(cfg<string>('ollama.endpoint'));
	}
}

/** Registers all agentic tools. */
function registerTools(ctx: vscode.ExtensionContext): void {
	ctx.subscriptions.push(
		// Core tools
		vscode.lm.registerTool('hcode_readFile', new ReadFileTool()),
		vscode.lm.registerTool('hcode_listDirectory', new ListDirectoryTool()),
		vscode.lm.registerTool('hcode_runTerminal', new RunTerminalTool()),
		vscode.lm.registerTool('hcode_searchCode', new SearchCodeTool()),
		vscode.lm.registerTool('hcode_gitStatus', new GitStatusTool()),
		vscode.lm.registerTool('hcode_getDiagnostics', new DiagnosticsTool()),
		// Advanced tools
		vscode.lm.registerTool('hcode_webSearch', new WebSearchTool()),
		vscode.lm.registerTool('hcode_inlineEdit', new InlineEditTool()),
		vscode.lm.registerTool('hcode_createFile', new CreateFileTool()),
	);
}

/** Guided provider setup wizard. */
async function runSetupWizard(): Promise<void> {
	const choice = await vscode.window.showQuickPick([
		{
			label: '$(server) Ollama — Local & Private',
			description: '🆓 100% Free • No internet • Privacy first',
			detail: 'Models: qwen2.5-coder, deepseek-coder, llama3.3, codellama, phi4',
			value: 'ollama',
		},
		{
			label: '$(sparkle) Google Gemini',
			description: '🆓 Free tier 2M tokens/month • Google Search grounding • Thinking mode',
			detail: 'Models: gemini-2.5-pro (best!), gemini-2.0-flash (free), gemini-2.0-flash-thinking',
			value: 'gemini',
		},
		{
			label: '$(zap) Groq — Ultra Fast',
			description: '🆓 Free 14.400 req/day • Fastest inference on Earth',
			detail: 'Models: llama-3.3-70b, mixtral-8x7b, gemma2-9b',
			value: 'groq',
		},
		{
			label: '$(hubot) DeepSeek',
			description: '🆓 Free $5 credit • Best coding AI • R1 reasoning visible',
			detail: 'Models: deepseek-chat (V3), deepseek-reasoner (R1)',
			value: 'deepseek',
		},
		{
			label: '$(github) GitHub Models',
			description: '🆓 Free with GitHub account • No extra signup',
			detail: 'Models: gpt-4o-mini, phi-4, llama-3.3-70b, mistral-large',
			value: 'github',
		},
		{
			label: '$(globe) OpenRouter',
			description: '🆓 Free models available • 200+ models gateway',
			detail: 'Models: qwen-2.5-coder:free, deepseek-r1:free, gemma-3-27b:free',
			value: 'openrouter',
		},
		{
			label: '$(robot) Grok (xAI)',
			description: '💳 Paid • xAI\'s flagship model • Strong reasoning',
			detail: 'Models: grok-3, grok-3-mini, grok-2',
			value: 'grok',
		},
		{
			label: '$(code) OpenAI / Codex',
			description: '💳 Paid • GPT-4o, o3-mini, Codex Mini',
			detail: 'Also works with: Groq endpoint, Together AI, LM Studio',
			value: 'openai',
		},
		{
			label: '$(brain) Anthropic Claude',
			description: '💳 Paid • claude-3.7-sonnet • Extended thinking',
			detail: 'Best for: Long context (200K), complex architecture, 3.7 Sonnet',
			value: 'anthropic',
		},
	], {
		title: 'HCode AI — Choose Your AI Provider',
		placeHolder: '🆓 = Free tier available  •  💳 = Paid only',
	});

	if (!choice) { return; }
	const config = vscode.workspace.getConfiguration('hcode.ai');
	await config.update('provider', choice.value, vscode.ConfigurationTarget.Global);

	// Provider-specific setup
	if (choice.value === 'gemini') {
		const key = await vscode.window.showInputBox({
			title: '$(sparkle) Google Gemini API Key',
			prompt: 'Get your free key at aistudio.google.com — 2M tokens/month free!',
			password: true,
			placeHolder: 'AIza...',
		});
		if (key) {
			await config.update('gemini.apiKey', key, vscode.ConfigurationTarget.Global);
			// Dynamic model listing
			const geminiProvider = new GeminiProvider(key);
			const models = await geminiProvider.listModels();
			if (models.length > 0) {
				const modelItems = [
					{ label: '$(sparkle) gemini-2.5-pro-exp-03-25', description: 'Most capable — like Google Antigravity', value: 'gemini-2.5-pro-exp-03-25' },
					{ label: '$(zap) gemini-2.0-flash', description: '🆓 Fast & free tier', value: 'gemini-2.0-flash' },
					{ label: '$(brain) gemini-2.0-flash-thinking-exp', description: '🆓 Free with visible reasoning', value: 'gemini-2.0-flash-thinking-exp' },
					...models
						.filter(m => !['gemini-2.5-pro-exp-03-25', 'gemini-2.0-flash', 'gemini-2.0-flash-thinking-exp'].includes(m))
						.map(m => ({ label: m, description: '', value: m }))
				];
				const modelChoice = await vscode.window.showQuickPick(modelItems, {
					title: 'Select Gemini Model',
					placeHolder: 'gemini-2.5-pro is the most capable (like Antigravity)',
				});
				if (modelChoice) {
					await config.update('gemini.model', modelChoice.value, vscode.ConfigurationTarget.Global);
				}
			}
		}
	} else if (choice.value === 'groq') {
		const key = await vscode.window.showInputBox({
			title: '$(zap) Groq API Key',
			prompt: 'Free at console.groq.com — 14.400 requests/day, no credit card',
			password: true,
			placeHolder: 'gsk_...',
		});
		if (key) {
			await config.update('groq.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'llama-3.3-70b-versatile', description: 'Best quality — free' },
				{ label: 'mixtral-8x7b-32768', description: '32K context — free' },
				{ label: 'gemma2-9b-it', description: 'Fast, Google model — free' },
				{ label: 'llama-3.1-8b-instant', description: 'Ultra fast — free' },
			], { title: 'Select Groq Model' });
			if (model) { await config.update('groq.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'deepseek') {
		const key = await vscode.window.showInputBox({
			title: '$(hubot) DeepSeek API Key',
			prompt: 'Get $5 free credit at platform.deepseek.com — best coding AI',
			password: true,
			placeHolder: 'sk-...',
		});
		if (key) {
			await config.update('deepseek.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'deepseek-chat', description: 'DeepSeek-V3 — best coding' },
				{ label: 'deepseek-reasoner', description: 'DeepSeek-R1 — shows chain-of-thought' },
			], { title: 'Select DeepSeek Model' });
			if (model) { await config.update('deepseek.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'github') {
		const token = await vscode.window.showInputBox({
			title: '$(github) GitHub Personal Access Token',
			prompt: 'Create a token at github.com/settings/tokens — select "models" scope',
			password: true,
			placeHolder: 'ghp_...',
		});
		if (token) {
			await config.update('github.token', token, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'gpt-4o-mini', description: 'Fast GPT-4o — free' },
				{ label: 'gpt-4o', description: 'Best GPT-4o — free (rate limited)' },
				{ label: 'Phi-4', description: 'Microsoft Phi-4 — fast & free' },
				{ label: 'Meta-Llama-3.3-70B-Instruct', description: 'Llama 3.3 — free' },
				{ label: 'Mistral-large-2411', description: 'Mistral Large — free' },
			], { title: 'Select GitHub Model' });
			if (model) { await config.update('github.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'openrouter') {
		const key = await vscode.window.showInputBox({
			title: '$(globe) OpenRouter API Key',
			prompt: 'Free at openrouter.ai/keys — no credit card needed for free models',
			password: true,
			placeHolder: 'sk-or-...',
		});
		if (key) {
			await config.update('openrouter.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'qwen/qwen-2.5-coder-32b-instruct:free', description: '🆓 Best free coding model' },
				{ label: 'deepseek/deepseek-r1:free', description: '🆓 Free reasoning model' },
				{ label: 'google/gemma-3-27b-it:free', description: '🆓 Free Google Gemma 3' },
				{ label: 'meta-llama/llama-3.3-70b-instruct:free', description: '🆓 Free Llama 3.3' },
				{ label: 'microsoft/phi-4:free', description: '🆓 Free Microsoft Phi-4' },
				{ label: 'anthropic/claude-3.7-sonnet', description: '💳 Claude 3.7 Sonnet' },
				{ label: 'openai/gpt-4o', description: '💳 GPT-4o' },
			], { title: 'Select OpenRouter Model' });
			if (model) { await config.update('openrouter.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'grok') {
		const key = await vscode.window.showInputBox({
			title: '$(robot) Grok (xAI) API Key',
			prompt: 'Get your key at console.x.ai',
			password: true,
			placeHolder: 'xai-...',
		});
		if (key) {
			await config.update('grok.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'grok-3', description: 'Most capable Grok' },
				{ label: 'grok-3-mini', description: 'Fast & cost-effective' },
				{ label: 'grok-2', description: 'Stable version' },
			], { title: 'Select Grok Model' });
			if (model) { await config.update('grok.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'openai') {
		const key = await vscode.window.showInputBox({
			title: '$(code) OpenAI API Key',
			prompt: 'Get your key at platform.openai.com',
			password: true,
			placeHolder: 'sk-...',
		});
		if (key) {
			await config.update('openai.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'gpt-4o', description: 'Best GPT-4o' },
				{ label: 'gpt-4o-mini', description: 'Fast & cheap' },
				{ label: 'codex-mini-latest', description: 'Codex — optimized for code' },
				{ label: 'o3-mini', description: 'o3-mini — reasoning model' },
			], { title: 'Select OpenAI Model' });
			if (model) { await config.update('openai.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'anthropic') {
		const key = await vscode.window.showInputBox({
			title: '$(brain) Anthropic API Key',
			prompt: 'Get your key at console.anthropic.com',
			password: true,
			placeHolder: 'sk-ant-...',
		});
		if (key) {
			await config.update('anthropic.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'claude-3-7-sonnet-latest', description: 'Best Claude — extended thinking' },
				{ label: 'claude-3-5-sonnet-20241022', description: 'Claude 3.5 Sonnet — fast' },
				{ label: 'claude-3-5-haiku-20241022', description: 'Claude Haiku — cheapest' },
			], { title: 'Select Claude Model' });
			if (model) { await config.update('anthropic.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'ollama') {
		const ollamaProvider = new OllamaProvider(cfg<string>('ollama.endpoint'));
		const available = await ollamaProvider.isAvailable();
		if (!available) {
			const action = await vscode.window.showWarningMessage(
				'Ollama is not running. Install it from ollama.ai and run: ollama pull qwen2.5-coder:7b',
				'Open ollama.ai',
				'Use Cloud Provider Instead',
			);
			if (action === 'Open ollama.ai') {
				vscode.env.openExternal(vscode.Uri.parse('https://ollama.ai'));
			} else if (action === 'Use Cloud Provider Instead') {
				await runSetupWizard();
			}
			return;
		}
		const models = await ollamaProvider.listModels();
		if (models.length > 0) {
			const modelChoice = await vscode.window.showQuickPick(
				models.map(m => ({ label: m })),
				{ title: 'Select Ollama Model', placeHolder: 'Recommended: qwen2.5-coder:7b' }
			);
			if (modelChoice) {
				await config.update('ollama.model', modelChoice.label, vscode.ConfigurationTarget.Global);
			}
		}
	}

	// Rebuild provider after config change
	provider = buildProvider();
	statusBar?.update(currentModel);
	vscode.window.showInformationMessage(`✅ HCode AI configured: ${provider.name} · ${currentModel}`);
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
	// Initialize provider
	provider = buildProvider();

	// Initialize workspace memory
	const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (workspaceFolderUri) {
		memory = new WorkspaceMemory(workspaceFolderUri);
		await memory.initializeDefaults('HCode');
	}

	// Status bar
	statusBar = new HCodeAIStatusBar(() => provider);
	statusBar.update(currentModel);
	ctx.subscriptions.push({ dispose: () => statusBar?.dispose() });

	// Create the main chat participant
	const agent = new HCodeAgent(
		() => provider,
		() => currentModel,
		memory,
		statusBar,
	);

	const participant = vscode.chat.createChatParticipant(HCODE_PARTICIPANT_ID, agent.handler);
	participant.iconPath = new vscode.ThemeIcon('sparkle');
	ctx.subscriptions.push(participant);

	// Register agentic tools
	registerTools(ctx);

	// Reload provider when settings change
	ctx.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('hcode.ai')) {
				provider = buildProvider();
				statusBar?.update(currentModel);
			}
		})
	);

	// ─── Commands ────────────────────────────────────────────────────────────

	ctx.subscriptions.push(
		vscode.commands.registerCommand('hcode.ai.setup', runSetupWizard),

		vscode.commands.registerCommand('hcode.ai.switchProvider', runSetupWizard),

		vscode.commands.registerCommand('hcode.ai.switchModel', async () => {
			const providerName = cfg<string>('provider');
			const config = vscode.workspace.getConfiguration('hcode.ai');

			if (providerName === 'ollama') {
				const ollamaProvider = new OllamaProvider(cfg<string>('ollama.endpoint'));
				const models = await ollamaProvider.listModels();
				const modelList = models.length > 0 ? models.map(m => ({ label: m })) : [
					{ label: 'qwen2.5-coder:7b' }, { label: 'codellama:13b' },
					{ label: 'deepseek-coder:6.7b' }, { label: 'phi4:14b' },
				];
				const picked = await vscode.window.showQuickPick(modelList, { title: 'Select Ollama Model' });
				if (picked) {
					await config.update('ollama.model', picked.label, vscode.ConfigurationTarget.Global);
				}
			} else {
				// Open settings for the current provider
				await vscode.commands.executeCommand('workbench.action.openSettings', `hcode.ai.${providerName}.model`);
			}
		}),

		vscode.commands.registerCommand('hcode.ai.clearMemory', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Clear HCode AI workspace memory? This will delete .hcode/ai-memory/ contents.',
				'Clear Memory', 'Cancel'
			);
			if (confirm === 'Clear Memory') {
				await memory?.clearMemory();
				vscode.window.showInformationMessage('HCode AI memory cleared.');
			}
		}),

		vscode.commands.registerCommand('hcode.ai.viewMemory', async () => {
			await memory?.openMemoryFile();
		}),

		vscode.commands.registerCommand('hcode.ai.generateCommitMessage', async () => {
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: '/commit' });
		}),

		vscode.commands.registerCommand('hcode.ai.explainSelection', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor?.selection || editor.selection.isEmpty) {
				vscode.window.showInformationMessage('Select some code first.');
				return;
			}
			await vscode.commands.executeCommand('workbench.action.chat.open', {
				query: 'Explain this code in detail.',
			});
		}),

		vscode.commands.registerCommand('hcode.ai.fixSelection', async () => {
			await vscode.commands.executeCommand('workbench.action.chat.open', {
				query: '/fix',
			});
		}),

		vscode.commands.registerCommand('hcode.ai.testSelection', async () => {
			await vscode.commands.executeCommand('workbench.action.chat.open', {
				query: '/test',
			});
		}),
	);

	// Show welcome on first install
	const isFirstInstall = !ctx.globalState.get('hcode.ai.installed');
	if (isFirstInstall) {
		await ctx.globalState.update('hcode.ai.installed', true);
		const action = await vscode.window.showInformationMessage(
			'🤖 HCode AI is ready! Configure your AI provider to get started.',
			'Configure Now'
		);
		if (action === 'Configure Now') {
			await runSetupWizard();
		}
	}
}

export function deactivate(): void {
	// Cleanup handled via ctx.subscriptions
}
