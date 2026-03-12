/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

const MEMORY_DIR = '.hcode/ai-memory';
const ARCHITECTURE_FILE = 'architecture.md';
const CONVENTIONS_FILE = 'conventions.md';
const DECISIONS_FILE = 'decisions.md';

/**
 * WorkspaceMemory — persistent AI context across sessions.
 * Stores project architecture, coding conventions, and AI decisions
 * in .hcode/ai-memory/ so the AI always knows your project's context.
 */
export class WorkspaceMemory {
	private readonly memoryUri: vscode.Uri;

	constructor(workspaceUri: vscode.Uri) {
		this.memoryUri = vscode.Uri.joinPath(workspaceUri, MEMORY_DIR);
	}

	/** Returns all memory files concatenated as a system context string. */
	async loadSystemContext(): Promise<string> {
		const parts: string[] = ['# HCode AI Workspace Memory\n'];

		const memoryFiles = [ARCHITECTURE_FILE, CONVENTIONS_FILE, DECISIONS_FILE];
		for (const file of memoryFiles) {
			const content = await this.readMemoryFile(file);
			if (content) {
				parts.push(`## ${file.replace('.md', '')}\n${content}\n`);
			}
		}

		// Also load any extra .hcode/ai-memory/*.md files
		try {
			const entries = await vscode.workspace.fs.readDirectory(this.memoryUri);
			for (const [name] of entries) {
				if (!name.endsWith('.md')) { continue; }
				if (memoryFiles.includes(name)) { continue; }
				const content = await this.readMemoryFile(name);
				if (content) {
					parts.push(`## ${name.replace('.md', '')}\n${content}\n`);
				}
			}
		} catch {
			// Memory directory doesn't exist yet — that's fine
		}

		return parts.length > 1 ? parts.join('\n') : '';
	}

	/** Records a decision made with the AI assistant. */
	async recordDecision(decision: string): Promise<void> {
		const timestamp = new Date().toISOString().split('T')[0];
		const entry = `\n### ${timestamp}\n${decision}\n`;
		const existing = await this.readMemoryFile(DECISIONS_FILE) ?? '';
		await this.writeMemoryFile(DECISIONS_FILE, existing + entry);
	}

	/** Initializes default memory files for a new workspace. */
	async initializeDefaults(productName?: string): Promise<void> {
		try {
			await vscode.workspace.fs.createDirectory(this.memoryUri);
		} catch {
			// Already exists
		}

		const hasArch = await this.readMemoryFile(ARCHITECTURE_FILE);
		if (!hasArch) {
			await this.writeMemoryFile(ARCHITECTURE_FILE, [
				`# Project Architecture`,
				``,
				`> Edit this file to help HCode AI understand your project structure.`,
				``,
				`## Overview`,
				`${productName ?? 'This project'} — describe your project here.`,
				``,
				`## Key Directories`,
				`- \`src/\` — main source code`,
				``,
				`## Important Notes`,
				`- Add any notes the AI should always know about this project`,
			].join('\n'));
		}

		const hasConv = await this.readMemoryFile(CONVENTIONS_FILE);
		if (!hasConv) {
			await this.writeMemoryFile(CONVENTIONS_FILE, [
				`# Coding Conventions`,
				``,
				`> Edit this file to store project coding conventions.`,
				``,
				`## Style`,
				`- Language: TypeScript`,
				`- Indentation: tabs`,
				``,
				`## Patterns`,
				`- Add architecture patterns used in this project`,
			].join('\n'));
		}
	}

	async clearMemory(): Promise<void> {
		const files = [ARCHITECTURE_FILE, CONVENTIONS_FILE, DECISIONS_FILE];
		for (const file of files) {
			try {
				await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.memoryUri, file));
			} catch {
				// File might not exist
			}
		}
	}

	async openMemoryFile(file: string = ARCHITECTURE_FILE): Promise<void> {
		const fileUri = vscode.Uri.joinPath(this.memoryUri, file);
		try {
			await vscode.workspace.fs.createDirectory(this.memoryUri);
		} catch { /* exists */ }
		// Create if doesn't exist
		try {
			await vscode.workspace.fs.stat(fileUri);
		} catch {
			await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(`# ${file.replace('.md', '')}\n\n`));
		}
		await vscode.window.showTextDocument(fileUri);
	}

	private async readMemoryFile(file: string): Promise<string | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.memoryUri, file));
			return new TextDecoder().decode(bytes);
		} catch {
			return undefined;
		}
	}

	private async writeMemoryFile(file: string, content: string): Promise<void> {
		try {
			await vscode.workspace.fs.createDirectory(this.memoryUri);
		} catch { /* exists */ }
		await vscode.workspace.fs.writeFile(
			vscode.Uri.joinPath(this.memoryUri, file),
			new TextEncoder().encode(content)
		);
	}
}
