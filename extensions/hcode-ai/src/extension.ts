/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { OllamaProvider } from './providers/ollamaProvider';
import { GeminiProvider } from './providers/geminiProvider';
import type { IHCodeProvider } from './providers/baseProvider';
import { registerNativeLanguageModelProviders } from './providers/nativeLanguageModelProvider';
import { buildConfiguredProvider, getConfiguredModel } from './providers/providerRegistry';
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

function rebuildConfiguredProvider(): void {
	provider = buildConfiguredProvider();
	currentModel = getConfiguredModel();
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
			description: '🆓 Free tier available • Google Search grounding • Thinking mode',
			detail: 'Models: gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro',
			value: 'gemini',
		},
		{
			label: '$(zap) Groq — Ultra Fast',
			description: '🆓 Free plan with rate limits • Very fast hosted inference',
			detail: 'Models: qwen/qwen3-32b, openai/gpt-oss-120b, kimi-k2, llama-4-scout',
			value: 'groq',
		},
		{
			label: '$(hubot) DeepSeek',
			description: '💸 Low cost • Strong coding and reasoning • R1 visible reasoning',
			detail: 'Models: deepseek-chat (V3), deepseek-reasoner (R1)',
			value: 'deepseek',
		},
		{
			label: '$(github) GitHub Models',
			description: '🆓 Included free, rate-limited • No separate provider billing',
			detail: 'Models: gpt-4o-mini, Phi-4, Llama, Mistral and more',
			value: 'github',
		},
		{
			label: '$(globe) OpenRouter',
			description: '🆓 Free router and free models available • 200+ models gateway',
			detail: 'Models: openrouter/free, qwen free, DeepSeek free, Gemma free',
			value: 'openrouter',
		},
		{
			label: '$(robot) Grok (xAI)',
			description: '💳 Paid • xAI API access • Strong reasoning',
			detail: 'Models: grok-4, grok-3, grok-3-mini',
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
		placeHolder: '🆓 = Free or free-tier available  •  💳 = Paid only',
	});

	if (!choice) { return; }
	const config = vscode.workspace.getConfiguration('hcode.ai');
	await config.update('provider', choice.value, vscode.ConfigurationTarget.Global);

	// Provider-specific setup
	if (choice.value === 'gemini') {
		const key = await vscode.window.showInputBox({
			title: '$(sparkle) Google Gemini API Key',
			prompt: 'Get your Gemini Developer API key at aistudio.google.com',
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
					{ label: '$(zap) gemini-2.5-flash', description: '🆓 Best default with free tier support', value: 'gemini-2.5-flash' },
					{ label: '$(rocket) gemini-2.5-flash-lite', description: '🆓 Fastest and cheapest Gemini 2.5 option', value: 'gemini-2.5-flash-lite' },
					{ label: '$(sparkle) gemini-2.5-pro', description: 'Most capable Gemini model', value: 'gemini-2.5-pro' },
					...models
						.filter(m => !['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'].includes(m))
						.map(m => ({ label: m, description: '', value: m }))
				];
				const modelChoice = await vscode.window.showQuickPick(modelItems, {
					title: 'Select Gemini Model',
					placeHolder: 'gemini-2.5-flash is the best default for the free tier',
				});
				if (modelChoice) {
					await config.update('gemini.model', modelChoice.value, vscode.ConfigurationTarget.Global);
				}
			}
		}
	} else if (choice.value === 'groq') {
		const key = await vscode.window.showInputBox({
			title: '$(zap) Groq API Key',
			prompt: 'Get your Groq API key at console.groq.com (free plan available)',
			password: true,
			placeHolder: 'gsk_...',
		});
		if (key) {
			await config.update('groq.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'qwen/qwen3-32b', description: 'Best coding default on the free plan' },
				{ label: 'openai/gpt-oss-120b', description: 'Open-weight reasoning and coding model' },
				{ label: 'moonshotai/kimi-k2-instruct', description: 'Strong coding and agentic behavior' },
				{ label: 'meta-llama/llama-4-scout-17b-16e-instruct', description: 'Fast multimodal Llama 4 model' },
			], { title: 'Select Groq Model' });
			if (model) { await config.update('groq.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'deepseek') {
		const key = await vscode.window.showInputBox({
			title: '$(hubot) DeepSeek API Key',
			prompt: 'Get your DeepSeek API key at platform.deepseek.com (very low cost; granted balance may apply)',
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
			prompt: 'Create a token that can access GitHub Models at github.com/settings/tokens',
			password: true,
			placeHolder: 'ghp_...',
		});
		if (token) {
			await config.update('github.token', token, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'gpt-4o-mini', description: 'Fast default model for GitHub Models' },
				{ label: 'gpt-4o', description: 'Higher quality, rate-limited included usage' },
				{ label: 'Phi-4', description: 'Microsoft Phi-4 on GitHub Models' },
				{ label: 'Meta-Llama-3.3-70B-Instruct', description: 'Llama family model on GitHub Models' },
				{ label: 'Mistral-large-2411', description: 'Mistral model on GitHub Models' },
			], { title: 'Select GitHub Model' });
			if (model) { await config.update('github.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'openrouter') {
		const key = await vscode.window.showInputBox({
			title: '$(globe) OpenRouter API Key',
			prompt: 'Get your OpenRouter API key at openrouter.ai/keys (use openrouter/free for the free router)',
			password: true,
			placeHolder: 'sk-or-...',
		});
		if (key) {
			await config.update('openrouter.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'openrouter/free', description: '🆓 OpenRouter free router across free providers' },
				{ label: 'qwen/qwen-2.5-coder-32b-instruct:free', description: '🆓 Strong free coding model' },
				{ label: 'deepseek/deepseek-r1:free', description: '🆓 Free reasoning model when available' },
				{ label: 'google/gemma-3-27b-it:free', description: '🆓 Free Gemma model' },
				{ label: 'microsoft/phi-4:free', description: '🆓 Free Phi-4 model' },
				{ label: 'anthropic/claude-3.7-sonnet', description: '💳 Claude 3.7 Sonnet' },
				{ label: 'openai/gpt-4o', description: '💳 GPT-4o' },
			], { title: 'Select OpenRouter Model' });
			if (model) { await config.update('openrouter.model', model.label, vscode.ConfigurationTarget.Global); }
		}
	} else if (choice.value === 'grok') {
		const key = await vscode.window.showInputBox({
			title: '$(robot) Grok (xAI) API Key',
			prompt: 'Get your paid xAI API key at console.x.ai',
			password: true,
			placeHolder: 'xai-...',
		});
		if (key) {
			await config.update('grok.apiKey', key, vscode.ConfigurationTarget.Global);
			const model = await vscode.window.showQuickPick([
				{ label: 'grok-4', description: 'Current flagship Grok model' },
				{ label: 'grok-3', description: 'Previous flagship Grok model' },
				{ label: 'grok-3-mini', description: 'Fast and lower-cost Grok model' },
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
	rebuildConfiguredProvider();
	statusBar?.update(currentModel);
	vscode.window.showInformationMessage(`✅ HCode AI configured: ${provider.name} · ${currentModel}`);
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
	// Initialize provider
	rebuildConfiguredProvider();

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

	// Register HCode language models in the native VS Code model picker
	registerNativeLanguageModelProviders(ctx);

	// Create the main chat participant
	const agent = new HCodeAgent(
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
				rebuildConfiguredProvider();
				statusBar?.update(currentModel);
			}
		})
	);

	// ─── Commands ────────────────────────────────────────────────────────────

	ctx.subscriptions.push(
		vscode.commands.registerCommand('hcode.ai.setup', runSetupWizard),
		vscode.commands.registerCommand('hcode.ai.focusChat', async () => {
			await vscode.commands.executeCommand('workbench.action.chat.open');
		}),

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
				query: '/explain',
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
