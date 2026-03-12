/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/**
 * WebSearchTool — Busca na internet usando DuckDuckGo (sem API key necessária).
 * Use para encontrar docs, erros, exemplos de código e notícias de tecnologia.
 */
export class WebSearchTool implements vscode.LanguageModelTool<{ query: string; maxResults?: number }> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ query: string; maxResults?: number }>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const { query, maxResults = 5 } = options.input;
		const encodedQuery = encodeURIComponent(query);

		try {
			// DuckDuckGo Instant Answer API — gratuito, sem API key
			const response = await fetch(
				`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`,
				{ headers: { 'User-Agent': 'HCode-AI/1.0' } }
			);

			if (!response.ok) {
				throw new Error(`Search request failed: ${response.status}`);
			}

			const data = await response.json() as {
				AbstractText?: string;
				AbstractURL?: string;
				AbstractSource?: string;
				RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
				Answer?: string;
				AnswerType?: string;
				Definition?: string;
				DefinitionURL?: string;
			};

			const results: string[] = [];

			// Direct answer (calculators, conversions, etc.)
			if (data.Answer) {
				results.push(`**Direct Answer:** ${data.Answer}`);
			}

			// Main abstract
			if (data.AbstractText) {
				results.push(`**${data.AbstractSource || 'Summary'}:** ${data.AbstractText}\n🔗 ${data.AbstractURL}`);
			}

			// Definition
			if (data.Definition) {
				results.push(`**Definition:** ${data.Definition}\n🔗 ${data.DefinitionURL}`);
			}

			// Related topics
			let topicCount = 0;
			for (const topic of data.RelatedTopics ?? []) {
				if (topicCount >= maxResults) { break; }
				if (topic.Text && topic.FirstURL) {
					results.push(`• ${topic.Text}\n  🔗 ${topic.FirstURL}`);
					topicCount++;
				} else if (topic.Topics) {
					// Grouped topics
					for (const sub of topic.Topics) {
						if (topicCount >= maxResults) { break; }
						if (sub.Text && sub.FirstURL) {
							results.push(`• ${sub.Text}\n  🔗 ${sub.FirstURL}`);
							topicCount++;
						}
					}
				}
			}

			if (results.length === 0) {
				// Fallback: provide search URLs for major sources
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(
						`No instant results found for "${query}". Try these links:\n` +
						`• MDN: https://developer.mozilla.org/en-US/search?q=${encodedQuery}\n` +
						`• Stack Overflow: https://stackoverflow.com/search?q=${encodedQuery}\n` +
						`• GitHub: https://github.com/search?q=${encodedQuery}\n` +
						`• npm: https://www.npmjs.com/search?q=${encodedQuery}`
					)
				]);
			}

			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					`Search results for "${query}":\n\n${results.slice(0, maxResults).join('\n\n')}`
				)
			]);

		} catch (err) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					`Search failed: ${(err as Error).message}\n\n` +
					`Try searching manually:\n` +
					`• https://www.google.com/search?q=${encodedQuery}\n` +
					`• https://stackoverflow.com/search?q=${encodedQuery}`
				)
			]);
		}
	}
}

/**
 * InlineEditTool — Aplica edições de código diretamente no arquivo ativo ou em arquivos específicos.
 * O AI pode reescrever seleções, inserir código e fazer refactoring real no workspace.
 */
export class InlineEditTool implements vscode.LanguageModelTool<{
	filePath?: string;
	startLine: number;
	endLine: number;
	newContent: string;
	description?: string;
}> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{
			filePath?: string;
			startLine: number;
			endLine: number;
			newContent: string;
			description?: string;
		}>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const { filePath, startLine, endLine, newContent, description } = options.input;

		try {
			let document: vscode.TextDocument;

			if (filePath) {
				const root = vscode.workspace.workspaceFolders?.[0]?.uri;
				if (!root) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]);
				}
				const uri = vscode.Uri.joinPath(root, filePath);
				document = await vscode.workspace.openTextDocument(uri);
			} else {
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No active editor.')]);
				}
				document = editor.document;
			}

			const totalLines = document.lineCount;
			const safeStart = Math.max(0, startLine - 1);
			const safeEnd = Math.min(totalLines - 1, endLine - 1);

			const startPos = new vscode.Position(safeStart, 0);
			const endPos = document.lineAt(safeEnd).range.end;
			const range = new vscode.Range(startPos, endPos);

			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, range, newContent);

			const success = await vscode.workspace.applyEdit(edit);

			if (!success) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart('Failed to apply edit. File may be read-only.')
				]);
			}

			// Show the file after edit
			await vscode.window.showTextDocument(document.uri, { preview: false });

			const rel = vscode.workspace.asRelativePath(document.uri);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(
					`✅ Edit applied to ${rel} (lines ${startLine}–${endLine})${description ? `: ${description}` : ''}`
				)
			]);

		} catch (err) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error applying edit: ${(err as Error).message}`)
			]);
		}
	}
}

/**
 * CreateFileTool — Cria novos arquivos no workspace com conteúdo especificado.
 */
export class CreateFileTool implements vscode.LanguageModelTool<{
	filePath: string;
	content: string;
	openAfterCreate?: boolean;
}> {
	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{
			filePath: string;
			content: string;
			openAfterCreate?: boolean;
		}>,
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const { filePath, content, openAfterCreate = true } = options.input;
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;

		if (!root) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No workspace open.')]);
		}

		const uri = vscode.Uri.joinPath(root, filePath);

		// Security check
		if (!uri.fsPath.startsWith(root.fsPath)) {
			return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Access denied: path is outside workspace.')]);
		}

		try {
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));

			if (openAfterCreate) {
				await vscode.window.showTextDocument(uri, { preview: false });
			}

			const rel = vscode.workspace.asRelativePath(uri);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`✅ Created file: ${rel}`)
			]);
		} catch (err) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Error creating file: ${(err as Error).message}`)
			]);
		}
	}
}
