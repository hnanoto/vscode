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
			label: '$(server) Ollama — Local Models',
			description: 'Free, private, no internet required. Install Ollama first.',
			detail: 'Best for: Privacy, offline use. Models: codellama, deepseek-coder, qwen2.5-coder',
			value: 'ollama',
		},
		{
			label: '$(globe) Google Gemini',
			description: 'Free tier available. Fast and capable.',
			detail: 'Best for: Free cloud AI. Models: gemini-2.0-flash (free), gemini-2.5-pro',
			value: 'gemini',
		},
		{
			label: '$(code) OpenAI / Codex',
			description: 'GPT-4o, GPT-4o-mini, Codex Mini. Requires API key.',
			detail: 'Best for: Premium coding quality. Also works with Groq, Together AI.',
			value: 'openai',
		},
		{
			label: '$(hubot) Anthropic Claude',
			description: 'Claude 3.5, Claude 3.7 Sonnet. Requires API key.',
			detail: 'Best for: Long context, complex reasoning, extended thinking.',
			value: 'anthropic',
		},
	], {
		title: 'HCode AI — Choose Your Provider',
		placeHolder: 'Select the AI provider to use',
	});

	if (!choice) { return; }
	const config = vscode.workspace.getConfiguration('hcode.ai');
	await config.update('provider', choice.value, vscode.ConfigurationTarget.Global);

	// Provider-specific API key setup
	if (choice.value === 'gemini') {
		const key = await vscode.window.showInputBox({
			title: 'Google Gemini API Key',
			prompt: 'Enter your Gemini API key (get one free at aistudio.google.com)',
			password: true,
			placeHolder: 'AIza...',
		});
		if (key) {
			await config.update('gemini.apiKey', key, vscode.ConfigurationTarget.Global);
		}
	} else if (choice.value === 'openai') {
		const key = await vscode.window.showInputBox({
			title: 'OpenAI API Key',
			prompt: 'Enter your OpenAI API key (platform.openai.com)',
			password: true,
			placeHolder: 'sk-...',
		});
		if (key) {
			await config.update('openai.apiKey', key, vscode.ConfigurationTarget.Global);
		}
	} else if (choice.value === 'anthropic') {
		const key = await vscode.window.showInputBox({
			title: 'Anthropic API Key',
			prompt: 'Enter your Anthropic API key (console.anthropic.com)',
			password: true,
			placeHolder: 'sk-ant-...',
		});
		if (key) {
			await config.update('anthropic.apiKey', key, vscode.ConfigurationTarget.Global);
		}
	} else if (choice.value === 'ollama') {
		// Try to detect Ollama and list available models
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
				{ title: 'Select Ollama Model', placeHolder: 'Choose a model' }
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
