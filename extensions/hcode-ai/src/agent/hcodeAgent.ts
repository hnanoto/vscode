/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import type { IHCodeProvider, IMessage } from '../providers/baseProvider';
import type { WorkspaceMemory } from '../memory/workspaceMemory';
import type { HCodeAIStatusBar } from '../ui/statusBar';

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

/**
 * Main HCode AI chat agent handler.
 * Registered as the default chat participant — responds to @hcode and to the main chat panel.
 */
export class HCodeAgent {
	constructor(
		private readonly getProvider: () => IHCodeProvider | undefined,
		private readonly getModel: () => string,
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
		const provider = this.getProvider();
		if (!provider) {
			stream.markdown('⚠️ **HCode AI is not configured.** Run `HCode AI: Configure Provider` to get started.');
			stream.button({ command: 'hcode.ai.setup', title: 'Configure Provider' });
			return;
		}

		this.statusBar.setLoading();

		try {
			const model = this.getModel();
			this.statusBar.update(model);

			// Handle slash commands
			if (request.command === 'setup') {
				await vscode.commands.executeCommand('hcode.ai.setup');
				return;
			}
			if (request.command === 'commit') {
				await this.handleCommitCommand(provider, model, stream, token);
				return;
			}

			// Build message history from context
			const messages = await this.buildMessages(request, context);

			// Stream the response
			let fullResponse = '';
			for await (const chunk of provider.chat(messages, { model, temperature: 0.2 }, token)) {
				stream.markdown(chunk);
				fullResponse += chunk;
			}

			// Log significant decisions to memory
			if (this.memory && fullResponse.length > 200 && this.looksLikeDecision(request.prompt)) {
				await this.memory.recordDecision(`**User asked:** ${request.prompt.slice(0, 200)}\n**Decision:** ${fullResponse.slice(0, 500)}`);
			}

		} catch (err) {
			const message = (err as Error).message ?? 'Unknown error';
			this.statusBar.setError(message.slice(0, 40));
			stream.markdown(`\n\n❌ **Error:** ${message}`);

			if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
				stream.markdown('\n\nIs Ollama running? Start it with: `ollama serve`');
				stream.button({ command: 'hcode.ai.switchProvider', title: 'Switch to Cloud Provider' });
			}
		}

		this.statusBar.update(this.getModel());
	};

	/** Handles /commit — generates a git commit message from staged diff. */
	private async handleCommitCommand(
		provider: IHCodeProvider,
		model: string,
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
		const messages: IMessage[] = [
			{ role: 'system', content: COMMIT_PROMPT },
			{ role: 'user', content: `Git diff:\n\`\`\`diff\n${diff.slice(0, 6000)}\n\`\`\`` },
		];

		for await (const chunk of provider.chat(messages, { model, temperature: 0.1 }, token)) {
			stream.markdown(chunk);
		}
	}

	/** Builds the full message array including system prompt, memory, and history. */
	private async buildMessages(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
	): Promise<IMessage[]> {
		const messages: IMessage[] = [];

		// System prompt
		let systemContent = SYSTEM_PROMPT;

		// Inject workspace memory
		if (this.memory) {
			const memContext = await this.memory.loadSystemContext();
			if (memContext) {
				systemContent += `\n\n${memContext}`;
			}
		}
		messages.push({ role: 'system', content: systemContent });

		// Conversation history (last 10 turns)
		const history = context.history.slice(-10);
		for (const turn of history) {
			if (turn instanceof vscode.ChatRequestTurn) {
				messages.push({ role: 'user', content: turn.prompt });
			} else if (turn instanceof vscode.ChatResponseTurn) {
				const text = turn.response
					.filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
					.map(p => p.value.value)
					.join('');
				if (text) {
					messages.push({ role: 'assistant', content: text });
				}
			}
		}

		// Current selected editor context
		const editor = vscode.window.activeTextEditor;
		let userContent = request.prompt;

		if (editor?.selection && !editor.selection.isEmpty) {
			const selection = editor.document.getText(editor.selection);
			const lang = editor.document.languageId;
			const file = vscode.workspace.asRelativePath(editor.document.uri);
			const startLine = editor.selection.start.line + 1;
			userContent = `File: ${file} (line ${startLine})\n\`\`\`${lang}\n${selection}\n\`\`\`\n\n${request.prompt}`;
		} else if (editor && !editor.selection.isEmpty) {
			const file = vscode.workspace.asRelativePath(editor.document.uri);
			userContent = `Current file: ${file}\n\n${request.prompt}`;
		}

		// Referenced files/variables from #file mentions
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

		messages.push({ role: 'user', content: userContent });
		return messages;
	}

	private looksLikeDecision(prompt: string): boolean {
		const keywords = ['how to', 'should i', 'best way', 'what approach', 'architecture', 'design'];
		const lower = prompt.toLowerCase();
		return keywords.some(k => lower.includes(k));
	}
}

export { HCODE_PARTICIPANT_ID };
