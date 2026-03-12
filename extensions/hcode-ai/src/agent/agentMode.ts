/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import type { IHCodeProvider, IMessage } from '../providers/baseProvider';

const AGENT_SYSTEM_PROMPT = `You are HCode AI in AGENT MODE — an autonomous software engineering agent.

You have access to these tools:
- hcode_readFile: Read any file in the workspace
- hcode_listDirectory: List files and directories
- hcode_runTerminal: Execute shell commands (npm, git, tests, etc.)
- hcode_searchCode: Search for patterns across the codebase
- hcode_gitStatus: Get git branch, status and recent commits
- hcode_getDiagnostics: Get TypeScript/LSP errors and warnings
- hcode_webSearch: Search the internet for documentation and answers
- hcode_inlineEdit: Edit code directly in files (PREFERRED for code changes)
- hcode_createFile: Create new files in the workspace

## How to work in Agent Mode:
1. UNDERSTAND the task fully before starting
2. EXPLORE the codebase with readFile/listDirectory/searchCode
3. PLAN your changes before executing them
4. IMPLEMENT using inlineEdit and createFile tools
5. VERIFY by running tests and checking diagnostics
6. REPORT what was done and what changed

## Rules:
- Always read a file before editing it — never guess structure
- Run diagnostics after code changes to catch new errors
- If a terminal command fails, read the error and fix it
- Prefer small, targeted edits over full file rewrites
- Always confirm before deleting files or running destructive commands
- Think step by step and be thorough`;

/**
 * Modo Agente Completo — o AI executa uma tarefa inteira autonomamente:
 * lê arquivos, edita código, roda testes, verifica erros e reporta o resultado.
 */
export async function runAgentMode(
	task: string,
	provider: IHCodeProvider,
	model: string,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<void> {
	stream.markdown(`## 🤖 Agent Mode\n\n**Task:** ${task}\n\n---\n\n`);
	stream.markdown(`_Analyzing your request..._\n\n`);

	const messages: IMessage[] = [
		{ role: 'system', content: AGENT_SYSTEM_PROMPT },
		{
			role: 'user', content:
				`Complete this task autonomously using the available tools:\n\n${task}\n\n` +
				`Start by exploring the codebase to understand the context, then implement the solution step by step. ` +
				`After each significant action, briefly explain what you did and why. ` +
				`When finished, provide a summary of all changes made.`
		}
	];

	let iterationCount = 0;
	const MAX_ITERATIONS = 20;

	while (iterationCount < MAX_ITERATIONS && !token.isCancellationRequested) {
		iterationCount++;
		stream.markdown(`\n_Step ${iterationCount}..._\n`);

		let fullResponse = '';
		for await (const chunk of provider.chat(messages, { model, temperature: 0.1 }, token)) {
			stream.markdown(chunk);
			fullResponse += chunk;
		}

		messages.push({ role: 'assistant', content: fullResponse });

		// Check if agent is done
		const isDone =
			fullResponse.toLowerCase().includes('task complete') ||
			fullResponse.toLowerCase().includes('all done') ||
			fullResponse.toLowerCase().includes('finished') ||
			fullResponse.toLowerCase().includes('summary of changes') ||
			fullResponse.toLowerCase().includes('## summary') ||
			fullResponse.toLowerCase().includes('completed successfully');

		if (isDone) {
			stream.markdown('\n\n---\n✅ **Agent task completed!**\n');
			break;
		}

		// Ask agent to continue if not done
		messages.push({
			role: 'user',
			content: 'Continue with the next step. If you need to use a tool, call it. If the task is complete, write "Task complete" and summarize what was done.'
		});
	}

	if (iterationCount >= MAX_ITERATIONS) {
		stream.markdown('\n\n⚠️ _Agent reached maximum iterations. Task may be incomplete._\n');
	}
}
