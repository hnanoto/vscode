/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

const AGENT_SYSTEM_PROMPT = `You are HCode AI in AGENT MODE - an autonomous software engineering agent.

You have access to these tools:
- hcode_readFile: Read any file in the workspace
- hcode_listDirectory: List files and directories
- hcode_runTerminal: Execute shell commands (npm, git, tests, etc.)
- hcode_searchCode: Search for patterns across the codebase
- hcode_gitStatus: Get git branch, status and recent commits
- hcode_getDiagnostics: Get TypeScript/LSP errors and warnings
- hcode_webSearch: Search the internet for documentation and answers
- hcode_inlineEdit: Edit code directly in files
- hcode_createFile: Create new files in the workspace

Rules:
- Always inspect code before changing it
- Prefer readFile, listDirectory, searchCode, gitStatus, and getDiagnostics before terminal commands
- Keep edits targeted and minimal
- Never ask the user to do something you can do with a tool
- Do not emit markdown, prose, or code fences
- Respond with exactly one JSON object matching this schema:
{
  "thought": "short sentence about the next step",
  "action": "one tool name from the list above, or final",
  "input": { "tool specific arguments": "..." },
  "final": "final markdown response for the user when action is final"
}

When action is "final":
- final must contain the complete user-facing answer
- input must be omitted

When action is a tool:
- input must be valid JSON for that tool
- final must be omitted

If a tool result shows an error, adapt and continue.`;

const TOOL_NAMES = [
	'hcode_readFile',
	'hcode_listDirectory',
	'hcode_runTerminal',
	'hcode_searchCode',
	'hcode_gitStatus',
	'hcode_getDiagnostics',
	'hcode_webSearch',
	'hcode_inlineEdit',
	'hcode_createFile',
] as const;

const MAX_ITERATIONS = 12;
const MODEL_TOOL_OUTPUT_LIMIT = 12_000;
const USER_TOOL_OUTPUT_LIMIT = 1_500;

type ToolName = typeof TOOL_NAMES[number];

interface AgentDirective {
	thought?: string;
	action?: string;
	input?: Record<string, unknown>;
	final?: string;
}

function isToolName(value: string): value is ToolName {
	return TOOL_NAMES.includes(value as ToolName);
}

function extractJsonObject(text: string): AgentDirective | undefined {
	const trimmed = text.trim();
	const candidates = [
		trimmed,
		trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, ''),
	];

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as AgentDirective;
			if (parsed && typeof parsed === 'object') {
				return parsed;
			}
		} catch {
			// Try to recover below using the first/last brace.
		}
	}

	const firstBrace = trimmed.indexOf('{');
	const lastBrace = trimmed.lastIndexOf('}');
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		try {
			return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as AgentDirective;
		} catch {
			return undefined;
		}
	}

	return undefined;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength)}\n...[truncated]`;
}

function renderToolResult(result: vscode.LanguageModelToolResult): string {
	const rendered: string[] = [];

	for (const part of result.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			rendered.push(part.value);
		} else if (part instanceof vscode.LanguageModelDataPart) {
			try {
				rendered.push(new TextDecoder().decode(part.data));
			} catch {
				rendered.push(`[data:${part.mimeType}]`);
			}
		} else {
			rendered.push(String(part));
		}
	}

	return rendered.join('\n').trim();
}

function formatToolRun(toolName: ToolName, input: Record<string, unknown> | undefined): string {
	const formattedInput = input && Object.keys(input).length
		? `\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
		: '';
	return `Using \`${toolName}\`${formattedInput}\n`;
}

/**
 * Runs an iterative agent loop that asks the model for the next tool action as JSON,
 * invokes the requested tool in the chat context, and feeds the result back to the model.
 */
export async function runAgentMode(
	task: string,
	model: vscode.LanguageModelChat,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	toolInvocationToken: vscode.ChatParticipantToolToken,
	systemContext?: string,
): Promise<void> {
	stream.markdown(`## Agent Mode\n\n**Task:** ${task}\n\n`);

	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(
			`${systemContext ? `${AGENT_SYSTEM_PROMPT}\n\n${systemContext}` : AGENT_SYSTEM_PROMPT}\n\n` +
			`Complete this task autonomously using the available tools:\n\n${task}\n\n` +
			'Start by exploring the codebase. Respond with JSON only.'
		),
	];

	for (let iteration = 1; iteration <= MAX_ITERATIONS && !token.isCancellationRequested; iteration++) {
		const rawResponse = await collectResponse(model, messages, token);
		const directive = extractJsonObject(rawResponse);

		if (!directive?.action) {
			stream.markdown(`Step ${iteration}: model returned invalid agent JSON, retrying.\n\n`);
			messages.push(vscode.LanguageModelChatMessage.Assistant(rawResponse));
			messages.push(vscode.LanguageModelChatMessage.User(
				'Your previous response was invalid. Reply with exactly one JSON object that matches the required schema. ' +
				'Do not include markdown fences or prose.'
			));
			continue;
		}

		const thought = directive.thought?.trim();
		if (thought) {
			stream.markdown(`Step ${iteration}: ${thought}\n\n`);
		}

		if (directive.action === 'final') {
			stream.markdown(directive.final?.trim() || 'Task complete.');
			stream.markdown('\n');
			return;
		}

		if (!isToolName(directive.action)) {
			stream.markdown(`Step ${iteration}: unsupported tool \`${directive.action}\`, retrying.\n\n`);
			messages.push(vscode.LanguageModelChatMessage.Assistant(rawResponse));
			messages.push(vscode.LanguageModelChatMessage.User(
				`The action "${directive.action}" is invalid. Use one of: ${TOOL_NAMES.join(', ')}, or final.`
			));
			continue;
		}

		stream.markdown(formatToolRun(directive.action, directive.input));

		let toolText: string;
		try {
			const toolResult = await vscode.lm.invokeTool(directive.action, {
				input: directive.input ?? {},
				toolInvocationToken,
			}, token);
			toolText = renderToolResult(toolResult);
		} catch (err) {
			toolText = `Tool error: ${(err as Error).message ?? 'Unknown error'}`;
		}

		const userFacingToolText = truncate(toolText || '(no output)', USER_TOOL_OUTPUT_LIMIT);
		stream.markdown(`Result from \`${directive.action}\`:\n\n\`\`\`text\n${userFacingToolText}\n\`\`\`\n\n`);

		messages.push(vscode.LanguageModelChatMessage.Assistant(JSON.stringify(directive)));
		messages.push(vscode.LanguageModelChatMessage.User(
			`Tool ${directive.action} finished.\n\n` +
			`Result:\n${truncate(toolText || '(no output)', MODEL_TOOL_OUTPUT_LIMIT)}\n\n` +
			'Choose the next action and respond with JSON only.'
		));
	}

	stream.markdown('⚠️ Agent reached the iteration limit before producing a final answer.\n');
}

async function collectResponse(
	model: vscode.LanguageModelChat,
	messages: vscode.LanguageModelChatMessage[],
	token: vscode.CancellationToken,
): Promise<string> {
	const response = await model.sendRequest(messages, {
		justification: 'Run the HCode AI autonomous agent loop for the active chat request.',
		modelOptions: {
			temperature: 0.1,
		},
	}, token);

	let fullResponse = '';
	for await (const chunk of response.text) {
		fullResponse += chunk;
	}
	return fullResponse.trim();
}
