/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import type { WorkspaceMemory } from '../memory/workspaceMemory';
import type { HCodeAIStatusBar } from '../ui/statusBar';
import { getProviderDisplayName } from '../providers/providerRegistry';
import { runAgentMode } from './agentMode';

const HCODE_PARTICIPANT_ID = 'hcode.ai';

const SYSTEM_PROMPT = `You are HCode AI, a world-class AI coding assistant built into the HCode IDE.
You are an expert software engineer with deep knowledge of TypeScript, JavaScript, Python, Rust, Go, and most modern languages.

Your capabilities:
- You can read files, list directories, run terminal commands, search code, and check diagnostics
- You have access to the git history and workspace context
- You remember the project architecture and conventions from workspace memory

Rules:
- Always prefer reading files before making assumptions about code
- Run diagnostics after suggesting code changes to verify no new errors were introduced
- Be concise but thorough in explanations
- Use markdown formatting for code blocks
- Reference specific file paths and line numbers when relevant
- When running terminal commands, explain what they do first
- Ask for confirmation before destructive operations`;

const COMMIT_PROMPT = `Generate a conventional commit message for the following git diff.
Format: <type>(<scope>): <description>
Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
Keep the description under 72 characters. Be specific and descriptive.
Only return the commit message, nothing else.`;

const COMMAND_PROMPTS: Record<string, string> = {
	explain: 'Explain the provided code or context clearly. Cover purpose, control flow, important details, and likely edge cases.',
	review: 'Review the provided code or context. Prioritize bugs, regressions, missing validation, incorrect assumptions, and missing tests. Present findings first.',
	doc: 'Write concise documentation for the provided code or context. Prefer actionable documentation, doc comments, and examples when helpful.',
};

const AGENT_COMMAND_PROMPTS: Record<string, string> = {
	fix: 'Fix bugs in the provided code or file. Apply edits directly when the correct change is clear, then verify with diagnostics.',
	refactor: 'Refactor the provided code or file for clarity and maintainability without changing behavior. Apply edits directly and verify diagnostics.',
	test: 'Generate or update automated tests for the provided code or file. Create or edit test files as needed, then verify diagnostics.',
	agent: 'Complete the task autonomously using the available tools.',
};

/**
 * Main HCode AI chat agent handler.
 * Registered as the default chat participant — responds to @hcode and to the main chat panel.
 */
export class HCodeAgent {
	constructor(
		private readonly memory: WorkspaceMemory | undefined,
		private readonly statusBar: HCodeAIStatusBar,
	) { }

	/**
	 * Main handler: called every time the user sends a message in chat.
	 */
	readonly handler: vscode.ChatRequestHandler = async (
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<void> => {
		this.statusBar.setLoading();

		try {
			const model = request.model;
			this.statusBar.update(model.name, this.getDisplayProviderName(model.vendor));

			// Handle slash commands
			if (request.command === 'setup') {
				await vscode.commands.executeCommand('hcode.ai.setup');
				return;
			}
			if (request.command === 'commit') {
				await this.handleCommitCommand(model, stream, token);
				return;
			}
			if (request.command && AGENT_COMMAND_PROMPTS[request.command]) {
				const agentTask = await this.buildUserPrompt(request, AGENT_COMMAND_PROMPTS[request.command]);
				const memoryContext = await this.buildMemoryContext();
				await runAgentMode(agentTask, model, stream, token, request.toolInvocationToken, memoryContext);
				return;
			}

			const messages = await this.buildMessages(request, context, COMMAND_PROMPTS[request.command ?? '']);
			const fullResponse = await this.streamModelResponse(
				model,
				messages,
				stream,
				token,
				'Respond to a HCode AI chat request in the editor.',
				0.2,
			);

			// Log significant decisions to memory
			if (this.memory && fullResponse.length > 200 && this.looksLikeDecision(request.prompt)) {
				await this.memory.recordDecision(`**User asked:** ${request.prompt.slice(0, 200)}\n**Decision:** ${fullResponse.slice(0, 500)}`);
			}

		} catch (err) {
			const message = (err as Error).message ?? 'Unknown error';
			this.statusBar.setError(message.slice(0, 40));
			stream.markdown(`\n\n❌ **Error:** ${message}`);

			if (message.includes('Configure HCode AI provider')) {
				stream.button({ command: 'hcode.ai.setup', title: 'Configure Provider' });
			}

			if (request.model.vendor === 'hcode-ollama' && (message.includes('ECONNREFUSED') || message.includes('fetch failed'))) {
				stream.markdown('\n\nIs Ollama running? Start it with: `ollama serve`');
				stream.button({ command: 'hcode.ai.switchProvider', title: 'Switch to Cloud Provider' });
			}
		}

		this.statusBar.update(request.model.name, this.getDisplayProviderName(request.model.vendor));
	};

	/** Handles /commit — generates a git commit message from staged diff. */
	private async handleCommitCommand(
		model: vscode.LanguageModelChat,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
	): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!root) {
			stream.markdown('No workspace open.');
			return;
		}

		const diff = await new Promise<string>(resolve => {
			const tmpOut = vscode.Uri.joinPath(vscode.Uri.file(root), `.hcode-ai-diff-${Date.now()}.txt`).fsPath;
			const cmd = `git diff --cached > "${tmpOut}" 2>&1`;
			const task = new vscode.Task(
				{ type: 'hcode-ai-git' }, vscode.TaskScope.Workspace,
				'hcode-ai-git', 'HCode AI',
				new vscode.ShellExecution(cmd, { cwd: root })
			);
			task.presentationOptions = { reveal: vscode.TaskRevealKind.Never, panel: vscode.TaskPanelKind.Dedicated };
			vscode.tasks.executeTask(task).then(exec => {
				const done = vscode.tasks.onDidEndTask(e => {
					if (e.execution !== exec) { return; }
					done.dispose();
					vscode.workspace.fs.readFile(vscode.Uri.file(tmpOut)).then(
						bytes => {
							const text = new TextDecoder().decode(bytes).trim();
							vscode.workspace.fs.delete(vscode.Uri.file(tmpOut)).then(undefined, undefined);
							resolve(text);
						},
						() => resolve('')
					);
				});
			}, () => resolve(''));
		});

		if (!diff) {
			stream.markdown('No staged changes found. Stage your changes with `git add` first.');
			return;
		}

		stream.markdown('Generating commit message...\n\n');
		const messages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(
				`${COMMIT_PROMPT}\n\nGit diff:\n\`\`\`diff\n${diff.slice(0, 6000)}\n\`\`\``
			),
		];

		await this.streamModelResponse(
			model,
			messages,
			stream,
			token,
			'Generate a conventional commit message from the staged git diff.',
			0.1,
		);
	}

	/** Builds the full message array including instructions, memory, and history. */
	private async buildMessages(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		commandPrompt?: string,
	): Promise<vscode.LanguageModelChatMessage[]> {
		const messages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(await this.buildInstructionPrompt()),
		];

		// Conversation history (last 10 turns)
		const history = context.history.slice(-10);
		for (const turn of history) {
			if (turn instanceof vscode.ChatRequestTurn) {
				messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
			} else if (turn instanceof vscode.ChatResponseTurn) {
				const text = turn.response
					.filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
					.map(p => p.value.value)
					.join('');
				if (text) {
					messages.push(vscode.LanguageModelChatMessage.Assistant(text));
				}
			}
		}

		messages.push(vscode.LanguageModelChatMessage.User(await this.buildUserPrompt(request, commandPrompt)));
		return messages;
	}

	private async buildInstructionPrompt(): Promise<string> {
		let prompt = `Follow these instructions for the HCode AI conversation:\n\n${SYSTEM_PROMPT}`;
		const memContext = await this.buildMemoryContext();
		if (memContext) {
			prompt += `\n\nWorkspace memory:\n${memContext}`;
		}
		return prompt;
	}

	private async buildMemoryContext(): Promise<string> {
		if (!this.memory) {
			return '';
		}
		return await this.memory.loadSystemContext();
	}

	private async buildUserPrompt(
		request: vscode.ChatRequest,
		commandPrompt?: string,
	): Promise<string> {
		const editor = vscode.window.activeTextEditor;
		const prompt = request.prompt.trim();
		const promptBody = commandPrompt
			? `${commandPrompt}${prompt ? `\n\nUser request:\n${prompt}` : ''}`
			: prompt;
		let userContent = promptBody || 'Use the attached editor context to respond.';

		if (editor?.selection && !editor.selection.isEmpty) {
			const selection = editor.document.getText(editor.selection);
			const lang = editor.document.languageId;
			const file = vscode.workspace.asRelativePath(editor.document.uri);
			const startLine = editor.selection.start.line + 1;
			userContent = `File: ${file} (line ${startLine})\n\`\`\`${lang}\n${selection}\n\`\`\`\n\n${userContent}`;
		} else if (editor) {
			const file = vscode.workspace.asRelativePath(editor.document.uri);
			userContent = `Current file: ${file}\n\n${userContent}`;
		}

		for (const ref of request.references ?? []) {
			if (ref.value instanceof vscode.Uri) {
				try {
					const doc = await vscode.workspace.openTextDocument(ref.value);
					const rel = vscode.workspace.asRelativePath(ref.value);
					userContent += `\n\nReferenced file (${rel}):\n\`\`\`${doc.languageId}\n${doc.getText().slice(0, 4000)}\n\`\`\``;
				} catch {
					// Skip unreadable references
				}
			}
		}

		return userContent;
	}

	private async streamModelResponse(
		model: vscode.LanguageModelChat,
		messages: vscode.LanguageModelChatMessage[],
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		justification: string,
		temperature: number,
		maxTokens?: number,
	): Promise<string> {
		const modelOptions: Record<string, number> = { temperature };
		if (typeof maxTokens === 'number') {
			modelOptions.maxTokens = maxTokens;
		}

		const response = await model.sendRequest(messages, {
			justification,
			modelOptions,
		}, token);

		let fullResponse = '';
		for await (const chunk of response.text) {
			stream.markdown(chunk);
			fullResponse += chunk;
		}

		return fullResponse;
	}

	private getDisplayProviderName(vendor: string): string {
		return getProviderDisplayName(vendor) ?? vendor;
	}

	private looksLikeDecision(prompt: string): boolean {
		const keywords = ['how to', 'should i', 'best way', 'what approach', 'architecture', 'design'];
		const lower = prompt.toLowerCase();
		return keywords.some(k => lower.includes(k));
	}
}

export { HCODE_PARTICIPANT_ID };
