/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

interface ReadFileInput { filePath: string; startLine?: number; endLine?: number }
interface ListDirInput { dirPath: string; maxDepth?: number }
interface SearchInput { pattern: string; filePattern?: string; isRegex?: boolean }
interface DiagnosticsInput { filePath?: string; severity?: 'error' | 'warning' | 'all' }

function workspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ─── Read File Tool ────────────────────────────────────────────────────────────

export class ReadFileTool implements vscode.LanguageModelTool<ReadFileInput> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ReadFileInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]); }

		const absPath = path.resolve(root, options.input.filePath);
		// Security: prevent path traversal outside workspace
		if (!absPath.startsWith(root)) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Access denied: path is outside workspace.')]);
		}

		try {
			const content = await fs.readFile(absPath, 'utf-8');
			const lines = content.split('\n');
			const start = Math.max(0, (options.input.startLine ?? 1) - 1);
			const end = options.input.endLine ? options.input.endLine : lines.length;
			const slice = lines.slice(start, end).join('\n');
			const lang = path.extname(absPath).slice(1) || 'text';
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`File: ${options.input.filePath} (lines ${start + 1}-${end})\n\`\`\`${lang}\n${slice}\n\`\`\``)
			]);
		} catch (err) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error reading file: ${(err as Error).message}`)]);
		}
	}
}

// ─── List Directory Tool ───────────────────────────────────────────────────────

export class ListDirectoryTool implements vscode.LanguageModelTool<ListDirInput> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<ListDirInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]); }

		const absPath = path.resolve(root, options.input.dirPath);
		if (!absPath.startsWith(root)) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Access denied: path is outside workspace.')]);
		}

		const maxDepth = options.input.maxDepth ?? 1;
		const lines: string[] = [];

		async function walk(dir: string, depth: number, prefix: string): Promise<void> {
			if (depth > maxDepth) { return; }
			try {
				const entries = await fs.readdir(dir, { withFileTypes: true });
				// Sort: directories first, then files
				entries.sort((a, b) => {
					if (a.isDirectory() && !b.isDirectory()) { return -1; }
					if (!a.isDirectory() && b.isDirectory()) { return 1; }
					return a.name.localeCompare(b.name);
				});
				for (const entry of entries) {
					if (entry.name.startsWith('.') && entry.name !== '.hcode') { continue; }
					if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') { continue; }
					const icon = entry.isDirectory() ? '📁' : '📄';
					lines.push(`${prefix}${icon} ${entry.name}`);
					if (entry.isDirectory()) {
						await walk(path.join(dir, entry.name), depth + 1, prefix + '  ');
					}
				}
			} catch {
				lines.push(`${prefix}[unreadable]`);
			}
		}

		await walk(absPath, 1, '');
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
		const root = workspaceRoot();
		const cwd = options.input.cwd
			? path.resolve(root ?? '', options.input.cwd)
			: (root ?? process.cwd());

		return new Promise<vscode.LanguageModelToolResult>(resolve => {
			let output = '';
			let errorOutput = '';

			const cp = require('node:child_process') as typeof import('node:child_process');
			const proc = cp.spawn(options.input.command, {
				shell: true,
				cwd,
				timeout: 60_000,
			});

			proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
			proc.stderr?.on('data', (d: Buffer) => { errorOutput += d.toString(); });

			const cancelDispose = token.onCancellationRequested(() => {
				proc.kill();
				resolve(new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Command was cancelled.')]));
			});

			proc.on('close', code => {
				cancelDispose.dispose();
				const combined = [
					output && `stdout:\n${output.trim()}`,
					errorOutput && `stderr:\n${errorOutput.trim()}`,
					`exit code: ${code ?? 'unknown'}`,
				].filter(Boolean).join('\n\n');
				resolve(new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(combined)]));
			});

			proc.on('error', err => {
				cancelDispose.dispose();
				resolve(new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Error: ${err.message}`)]));
			});
		});
	}
}

// ─── Search Code Tool ──────────────────────────────────────────────────────────

export class SearchCodeTool implements vscode.LanguageModelTool<SearchInput> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<SearchInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { pattern, filePattern, isRegex } = options.input;
		const include = filePattern ?? '**/*';
		const exclude = '**/node_modules/**,**/out/**,**/dist/**,.build/**';

		const flags = isRegex ? undefined : undefined; // ripgrep handles it
		const results = await vscode.workspace.findTextInFiles(
			{ pattern, isRegex: isRegex ?? false, isCaseSensitive: true },
			{ include, exclude },
			(result) => { results.push(result); },
			token
		);

		// findTextInFiles returns void, results captured via callback
		const matches: string[] = [];
		await vscode.workspace.findTextInFiles(
			{ pattern, isRegex: isRegex ?? false },
			{ include, exclude, maxResults: 50 },
			result => {
				if ('ranges' in result) {
					for (const range of result.ranges) {
						const rel = vscode.workspace.asRelativePath(result.uri);
						matches.push(`${rel}:${range.start.line + 1}: ${result.preview.text.trim()}`);
					}
				}
			},
			token
		);

		if (matches.length === 0) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`No matches found for: ${pattern}`)]);
		}
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`Found ${matches.length} matches for "${pattern}":\n${matches.join('\n')}`)
		]);
	}
}

// ─── Git Status Tool ───────────────────────────────────────────────────────────

export class GitStatusTool implements vscode.LanguageModelTool<Record<string, never>> {
	async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const root = workspaceRoot();
		if (!root) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]); }

		const runGit = (args: string): Promise<string> => {
			return new Promise((resolve) => {
				const cp = require('node:child_process') as typeof import('node:child_process');
				cp.exec(`git ${args}`, { cwd: root, timeout: 10_000 }, (_err, stdout, stderr) => {
					resolve(stdout.trim() || stderr.trim());
				});
			});
		};

		const [status, log, branch] = await Promise.all([
			runGit('status --short'),
			runGit('log --oneline -5'),
			runGit('branch --show-current'),
		]);

		const output = [
			`Branch: ${branch}`,
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

export class DiagnosticsTool implements vscode.LanguageModelTool<DiagnosticsInput> {
	async invoke(options: vscode.LanguageModelToolInvocationOptions<DiagnosticsInput>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const severityFilter = options.input.severity ?? 'all';
		let diags = vscode.languages.getDiagnostics();

		if (options.input.filePath) {
			const root = workspaceRoot();
			const absPath = root ? path.resolve(root, options.input.filePath) : options.input.filePath;
			const uri = vscode.Uri.file(absPath);
			const fileDiags = vscode.languages.getDiagnostics(uri);
			diags = [[uri, fileDiags]];
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
