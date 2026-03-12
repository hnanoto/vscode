/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

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
	private readonly memoryPath: string;

	constructor(private readonly workspaceRoot: string) {
		this.memoryPath = path.join(workspaceRoot, MEMORY_DIR);
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

		// Also load custom .hcode/ai-memory/*.md files
		try {
			const entries = await fs.readdir(this.memoryPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile() || !entry.name.endsWith('.md')) { continue; }
				if (memoryFiles.includes(entry.name)) { continue; }
				const content = await this.readMemoryFile(entry.name);
				if (content) {
					parts.push(`## ${entry.name.replace('.md', '')}\n${content}\n`);
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
		await fs.mkdir(this.memoryPath, { recursive: true });

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
				await fs.unlink(path.join(this.memoryPath, file));
			} catch {
				// File might not exist
			}
		}
	}

	async openMemoryFile(file: string = ARCHITECTURE_FILE): Promise<void> {
		const filePath = path.join(this.memoryPath, file);
		await fs.mkdir(this.memoryPath, { recursive: true });
		// Create the file if it doesn't exist
		try {
			await fs.access(filePath);
		} catch {
			await fs.writeFile(filePath, `# ${file.replace('.md', '')}\n\n`, 'utf-8');
		}
		const uri = vscode.Uri.file(filePath);
		await vscode.window.showTextDocument(uri);
	}

	private async readMemoryFile(file: string): Promise<string | undefined> {
		try {
			return await fs.readFile(path.join(this.memoryPath, file), 'utf-8');
		} catch {
			return undefined;
		}
	}

	private async writeMemoryFile(file: string, content: string): Promise<void> {
		await fs.mkdir(this.memoryPath, { recursive: true });
		await fs.writeFile(path.join(this.memoryPath, file), content, 'utf-8');
	}
}
