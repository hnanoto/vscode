/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const result = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			continue;
		}

		const key = arg.slice(2);
		const value = argv[i + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for argument ${arg}`);
		}

		result[key] = value;
		i++;
	}

	return result;
}

async function listFilesRecursively(root) {
	/** @type {string[]} */
	const files = [];

	async function walk(current) {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile()) {
				files.push(fullPath);
			}
		}
	}

	await walk(root);
	return files;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function createHeaders(token) {
	/** @type {Record<string, string>} */
	const headers = {
		accept: 'application/vnd.github+json',
		'user-agent': 'hcode-update-feed-validator'
	};

	if (token) {
		headers.authorization = `Bearer ${token}`;
	}

	return headers;
}

async function fetchReleaseByTag(repo, tag, headers) {
	const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
	const response = await fetch(url, { headers });
	const responseText = await response.text();

	if (!response.ok) {
		const error = /** @type {Error & { status?: number; body?: string }} */ (new Error(`GitHub API request failed (${response.status}) for ${url}`));
		error.status = response.status;
		error.body = responseText;
		throw error;
	}

	return JSON.parse(responseText);
}

async function waitForReleaseWithAssets({ repo, tag, expectedAssets, retries, retryDelayMs, headers }) {
	let lastError;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const release = await fetchReleaseByTag(repo, tag, headers);
			const releaseAssets = Array.isArray(release.assets) ? release.assets : [];
			const publishedNames = new Set(releaseAssets.map(asset => asset.name).filter(name => typeof name === 'string'));
			const missing = expectedAssets.filter(name => !publishedNames.has(name));

			if (missing.length === 0) {
				return release;
			}

			lastError = new Error(`Release ${tag} is missing assets: ${missing.join(', ')}`);
			console.log(`[attempt ${attempt}/${retries}] Release found, but assets are still missing: ${missing.join(', ')}`);
		} catch (error) {
			const status = /** @type {{ status?: number }} */ (error).status;
			if (status === 404 || status === 422) {
				lastError = error;
				console.log(`[attempt ${attempt}/${retries}] Release ${tag} is not available yet.`);
			} else {
				lastError = error;
				console.log(`[attempt ${attempt}/${retries}] Failed to query release metadata: ${error.message}`);
			}
		}

		if (attempt < retries) {
			await sleep(retryDelayMs);
		}
	}

	throw lastError ?? new Error(`Release ${tag} could not be verified.`);
}

async function waitForAssetDownloadUrl(url, retries, retryDelayMs) {
	let lastStatus = 0;
	let lastError;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await fetch(url, {
				method: 'GET',
				redirect: 'follow',
				headers: {
					'user-agent': 'hcode-update-feed-validator',
					range: 'bytes=0-0'
				}
			});

			if (response.status === 200 || response.status === 206) {
				return;
			}

			lastStatus = response.status;
			console.log(`[attempt ${attempt}/${retries}] Asset URL returned status ${response.status}: ${url}`);
		} catch (error) {
			lastError = error;
			console.log(`[attempt ${attempt}/${retries}] Failed to verify asset URL ${url}: ${error.message}`);
		}

		if (attempt < retries) {
			await sleep(retryDelayMs);
		}
	}

	if (lastError) {
		throw new Error(`Could not verify asset URL ${url}: ${lastError.message}`);
	}

	throw new Error(`Asset URL ${url} is not reachable (last status: ${lastStatus || 'unknown'})`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const repo = args.repo;
	const tag = args.tag;
	const artifactsDir = args['artifacts-dir'];
	const retries = Number(args.retries ?? '12');
	const retryDelayMs = Number(args['retry-delay-ms'] ?? '10000');

	if (!repo || !tag || !artifactsDir) {
		throw new Error('Usage: node .github/scripts/verify-release-assets.mjs --repo <owner/repo> --tag <tag> --artifacts-dir <dir> [--retries 12] [--retry-delay-ms 10000]');
	}

	const artifactsDirStats = await stat(artifactsDir);
	if (!artifactsDirStats.isDirectory()) {
		throw new Error(`Artifacts directory is not a directory: ${artifactsDir}`);
	}

	const files = await listFilesRecursively(artifactsDir);
	if (files.length === 0) {
		throw new Error(`No artifact files found in ${artifactsDir}`);
	}

	const expectedAssets = [...new Set(files.map(filePath => path.basename(filePath)))].sort();
	console.log(`Validating release ${tag} in ${repo} with ${expectedAssets.length} expected assets.`);

	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
	const headers = createHeaders(token);
	const release = await waitForReleaseWithAssets({ repo, tag, expectedAssets, retries, retryDelayMs, headers });

	const assets = Array.isArray(release.assets) ? release.assets : [];
	/** @type {Map<string, string>} */
	const assetUrlByName = new Map();
	for (const asset of assets) {
		if (typeof asset?.name === 'string' && typeof asset?.browser_download_url === 'string') {
			assetUrlByName.set(asset.name, asset.browser_download_url);
		}
	}

	for (const assetName of expectedAssets) {
		const downloadUrl = assetUrlByName.get(assetName);
		if (!downloadUrl) {
			throw new Error(`Missing browser download URL for asset ${assetName}`);
		}

		await waitForAssetDownloadUrl(downloadUrl, retries, retryDelayMs);
	}

	console.log(`Release ${tag} is available and all expected assets are downloadable.`);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
