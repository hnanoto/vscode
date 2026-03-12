/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Hnanoto. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import type { IHCodeProvider } from '../providers/baseProvider';

/**
 * Status bar item showing current AI provider and model.
 * Click to switch providers quickly.
 */
export class HCodeAIStatusBar {
	private readonly item: vscode.StatusBarItem;

	constructor(private readonly getProvider: () => IHCodeProvider | undefined) {
		this.item = vscode.window.createStatusBarItem(
			'hcode.ai.statusBar',
			vscode.StatusBarAlignment.Right,
			100
		);
		this.item.command = 'hcode.ai.switchProvider';
		this.item.tooltip = 'HCode AI — Click to switch provider or model';
		this.update();
		this.item.show();
	}

	update(modelName?: string): void {
		const provider = this.getProvider();
		if (!provider) {
			this.item.text = '$(robot) HCode AI: Not configured';
			this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
			return;
		}
		const model = modelName ?? '...';
		this.item.text = `$(sparkle) ${provider.name} · ${model}`;
		this.item.backgroundColor = undefined;
	}

	setLoading(): void {
		this.item.text = '$(loading~spin) HCode AI: thinking…';
	}

	setError(msg: string): void {
		this.item.text = `$(error) HCode AI: ${msg}`;
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		// Reset after 5s
		setTimeout(() => this.update(), 5000);
	}

	dispose(): void {
		this.item.dispose();
	}
}
