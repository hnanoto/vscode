/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';

export interface IHCodeProvider {
	readonly id: string;
	readonly name: string;
	chat(messages: IMessage[], options: IChatOptions, token: vscode.CancellationToken): AsyncIterable<string>;
	isAvailable(): Promise<boolean>;
}

export interface IMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface IChatOptions {
	model: string;
	temperature?: number;
	maxTokens?: number;
}

export interface IProviderConfig {
	endpoint?: string;
	apiKey?: string;
	model: string;
}
