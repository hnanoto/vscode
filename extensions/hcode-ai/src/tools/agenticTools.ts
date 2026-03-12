/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/** Returns workspace root path or undefined. */
function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Runs a shell command and returns stdout+stderr. Uses the VS Code shell task API to avoid needing child_process types. */
function runShell(command: string, cwd: string, token: vscode.CancellationToken): Promise<string> {
	return new Promise(resolve => {
		// Use ShellExecution via vscode task system
		const task = new vscode.Task(
			{ type: 'hcode-ai-shell' },
			vscode.TaskScope.Workspace,
			'hcode-ai-shell',
			'HCode AI',
			new vscode.ShellExecution(command, { cwd }),
		);
		task.presentationOptions = { reveal: vscode.TaskRevealKind.Never, panel: vscode.TaskPanelKind.Dedicated };

		// Fallback: use exec via shell
		// We use a simpler approach to avoid child_process types: ShellExecution captures output via a temp file
		const tmpOut = vscode.Uri.joinPath(vscode.Uri.file(cwd), `.hcode-ai-tmp-${Date.now()}.txt`).fsPath;
	const wrappedCmd = vscode.env.appHost === 'desktop'
		? `${command} > "${tmpOut}" 2>&1`
		: `${command} > "${tmpOut}" 2>&1`;

		const wrappedTask = new vscode.Task(
			{ type: 'hcode-ai-shell' },
			vscode.TaskScope.Workspace,
			'hcode-ai',
			'HCode AI',
			new vscode.ShellExecution(wrappedCmd, { cwd }),
		);
		wrappedTask.presentationOptions = { reveal: vscode.TaskRevealKind.Never, panel: vscode.TaskPanelKind.Dedicated };

		const cancelDispose = token.onCancellationRequested(() => {
			resolve('(cancelled)');
		});

		vscode.tasks.executeTask(wrappedTask).then(exec => {
			const done = vscode.tasks.onDidEndTask(e => {
				if (e.execution === exec) {
					done.dispose();
					cancelDispose.dispose();
					// Read temp file
					vscode.workspace.fs.readFile(vscode.Uri.file(tmpOut)).then(
						bytes => {
							const text = new TextDecoder().decode(bytes);
							// Clean up temp file (fire and forget)
							vscode.workspace.fs.delete(vscode.Uri.file(tmpOut)).then(undefined, undefined);
							resolve(text.trim());
						},
						() => resolve('(no output)')
					);
				}
			});
		}, () => {
			cancelDispose.dispose();
			resolve('(task failed to start)');
		});
	});
}

// ─── Read File Tool ────────────────────────────────────────────────────────────

export class ReadFileTool implements vscode.LanguageModelTool<{ filePath: string; startLine?: number; endLine?: number }> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ filePath: string; startLine?: number; endLine?: number }>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]);
		}

		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), options.input.filePath);
		// Security: prevent path traversal outside workspace
		if (!uri.fsPath.startsWith(root)) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Access denied: path is outside workspace.')]);
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const content = new TextDecoder().decode(bytes);
			const lines = content.split('\n');
			const start = Math.max(0, (options.input.startLine ?? 1) - 1);
			const end = options.input.endLine ? options.input.endLine : lines.length;
			const slice = lines.slice(start, end).join('\n');
			const ext = options.input.filePath.split('.').pop() ?? 'text';
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					`File: ${options.input.filePath} (lines ${start + 1}-${end})\n\`\`\`${ext}\n${slice}\n\`\`\``
				)
			]);
		} catch (err) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error reading file: ${(err as Error).message}`)
			]);
		}
	}
}

// ─── List Directory Tool ───────────────────────────────────────────────────────

export class ListDirectoryTool implements vscode.LanguageModelTool<{ dirPath: string; maxDepth?: number }> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ dirPath: string; maxDepth?: number }>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]);
		}

		const dirUri = vscode.Uri.joinPath(vscode.Uri.file(root), options.input.dirPath);
		if (!dirUri.fsPath.startsWith(root)) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Access denied: path is outside workspace.')]);
		}

		const maxDepth = options.input.maxDepth ?? 1;
		const lines: string[] = [];

		const walk = async (uri: vscode.Uri, depth: number, prefix: string): Promise<void> => {
			if (depth > maxDepth) { return; }
			try {
				const entries = await vscode.workspace.fs.readDirectory(uri);
				// Sort: directories first, then files
				entries.sort(([aName, aType], [bName, bType]) => {
					const aIsDir = (aType & vscode.FileType.Directory) !== 0;
					const bIsDir = (bType & vscode.FileType.Directory) !== 0;
					if (aIsDir && !bIsDir) { return -1; }
					if (!aIsDir && bIsDir) { return 1; }
					return aName.localeCompare(bName);
				});
				for (const [name, type] of entries) {
					if (name.startsWith('.') && name !== '.hcode') { continue; }
					if (name === 'node_modules' || name === 'out' || name === 'dist') { continue; }
					const isDir = (type & vscode.FileType.Directory) !== 0;
					const icon = isDir ? '📁' : '📄';
					lines.push(`${prefix}${icon} ${name}`);
					if (isDir) {
						await walk(vscode.Uri.joinPath(uri, name), depth + 1, prefix + '  ');
					}
				}
			} catch {
				lines.push(`${prefix}[unreadable]`);
			}
		};

		await walk(dirUri, 1, '');
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`Directory: ${options.input.dirPath}\n${lines.join('\n')}`)
		]);
	}
}

// ─── Run Terminal Tool ─────────────────────────────────────────────────────────

export class RunTerminalTool implements vscode.LanguageModelTool<{ command: string; cwd?: string }> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ command: string; cwd?: string }>,
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot() ?? '.';
		const cwd = options.input.cwd
			? vscode.Uri.joinPath(vscode.Uri.file(root), options.input.cwd).fsPath
			: root;

		const output = await runShell(options.input.command, cwd, token);
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`$ ${options.input.command}\n${output}`)
		]);
	}
}

// ─── Search Code Tool ──────────────────────────────────────────────────────────

export class SearchCodeTool implements vscode.LanguageModelTool<{ pattern: string; filePattern?: string; isRegex?: boolean }> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ pattern: string; filePattern?: string; isRegex?: boolean }>,
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]);
		}

		const { pattern, filePattern, isRegex } = options.input;
		// Use ripgrep (rg) which ships with VS Code
		const rgFlags = isRegex ? '' : '--fixed-strings';
		const include = filePattern ? `--glob "${filePattern}"` : '';
		const exclude = '--glob "!node_modules" --glob "!out" --glob "!dist" --glob "!.build"';
		const rgPath = vscode.env.appRoot
			? `"${vscode.Uri.joinPath(vscode.Uri.file(vscode.env.appRoot), 'node_modules/@vscode/ripgrep/bin/rg').fsPath}"`
			: 'rg';

		const cmd = `${rgPath} ${rgFlags} ${include} ${exclude} --line-number --max-count 50 "${pattern.replace(/"/g, '\\"')}" .`;
		const output = await runShell(cmd, root, token);

		if (!output || output.includes('(no output)') || output.includes('(cancelled)')) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`No matches found for: ${pattern}`)
			]);
		}

		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`Search results for "${pattern}":\n${output}`)
		]);
	}
}

// ─── Git Status Tool ───────────────────────────────────────────────────────────

export class GitStatusTool implements vscode.LanguageModelTool<Record<string, never>> {
	async invoke(
		_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]);
		}

		const [status, log, branch] = await Promise.all([
			runShell('git status --short', root, token),
			runShell('git log --oneline -5', root, token),
			runShell('git branch --show-current', root, token),
		]);

		const output = [
			`Branch: ${branch || '(unknown)'}`,
			'',
			'Status:',
			status || '(clean)',
			'',
			'Recent commits:',
			log || '(none)',
		].join('\n');

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(output)]);
	}
}

// ─── Diagnostics Tool ─────────────────────────────────────────────────────────

export class DiagnosticsTool implements vscode.LanguageModelTool<{ filePath?: string; severity?: 'error' | 'warning' | 'all' }> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ filePath?: string; severity?: 'error' | 'warning' | 'all' }>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const severityFilter = options.input.severity ?? 'all';
		let diags = vscode.languages.getDiagnostics();

		if (options.input.filePath) {
			const root = workspaceRoot();
			const uri = root
				? vscode.Uri.joinPath(vscode.Uri.file(root), options.input.filePath)
				: vscode.Uri.file(options.input.filePath);
			diags = [[uri, vscode.languages.getDiagnostics(uri)]];
		}

		const lines: string[] = [];
		let total = 0;

		for (const [uri, fileDiags] of diags) {
			const filtered = fileDiags.filter(d => {
				if (severityFilter === 'error') { return d.severity === vscode.DiagnosticSeverity.Error; }
				if (severityFilter === 'warning') { return d.severity === vscode.DiagnosticSeverity.Warning; }
				return d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning;
			});
			if (filtered.length === 0) { continue; }
			const rel = vscode.workspace.asRelativePath(uri);
			for (const d of filtered) {
				const sev = d.severity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️';
				lines.push(`${sev} ${rel}:${d.range.start.line + 1}: ${d.message}`);
				total++;
			}
		}

		if (total === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('✅ No errors or warnings found.')]);
		}
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`Found ${total} diagnostic(s):\n${lines.join('\n')}`)
		]);
	}
}
