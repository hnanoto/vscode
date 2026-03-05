/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

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

function pickFile(assets, label, predicate) {
	const found = assets.find(predicate);
	if (!found) {
		throw new Error(`Could not find ${label} in downloaded artifacts.`);
	}
	return found;
}

async function sha256File(filePath) {
	return await new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

async function readJsonIfExists(filePath, fallbackValue) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch {
		return fallbackValue;
	}
}

async function writeJson(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, JSON.stringify(value, null, '\t') + '\n', 'utf8');
}

async function writeRaw(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, value, 'utf8');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const artifactsDir = args['artifacts-dir'];
	const existingFeedDir = args['existing-feed-dir'];
	const outputDir = args['output-dir'];
	const repo = args.repo;
	const tag = args.tag;
	const commit = args.commit;
	const version = args.version;
	const quality = args.quality ?? 'stable';
	const maxHistory = Number(args['max-history'] ?? '300');

	if (!artifactsDir || !existingFeedDir || !outputDir || !repo || !tag || !commit || !version) {
		throw new Error('Usage: node .github/scripts/generate-update-feed.mjs --artifacts-dir <dir> --existing-feed-dir <dir> --output-dir <dir> --repo <owner/repo> --tag <tag> --commit <sha> --version <version> [--quality stable] [--max-history 300]');
	}

	const artifactsDirStats = await stat(artifactsDir);
	if (!artifactsDirStats.isDirectory()) {
		throw new Error(`Artifacts directory is not a directory: ${artifactsDir}`);
	}

	const files = await listFilesRecursively(artifactsDir);
	if (files.length === 0) {
		throw new Error(`No artifact files found in ${artifactsDir}`);
	}

	const assets = files.map(filePath => ({
		filePath,
		name: path.basename(filePath)
	}));

	const linuxTar = pickFile(assets, 'Linux x64 tar.gz', asset => /linux-x64.*\.tar\.gz$/i.test(asset.name));
	const darwinX64Zip = pickFile(assets, 'macOS Intel zip', asset => /darwin-x64.*\.zip$/i.test(asset.name));
	const darwinArm64Zip = pickFile(assets, 'macOS ARM64 zip', asset => /darwin-arm64.*\.zip$/i.test(asset.name));
	const windowsUserSetup = pickFile(assets, 'Windows x64 user setup', asset => /usersetup.*x64.*\.exe$/i.test(asset.name));
	const windowsSystemSetup = pickFile(assets, 'Windows x64 system setup', asset => /setup.*x64.*\.exe$/i.test(asset.name) && !/usersetup/i.test(asset.name));
	const windowsArchiveZip = pickFile(assets, 'Windows x64 zip archive', asset => /win32-x64.*\.zip$/i.test(asset.name));

	const assetUrl = name => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;

	const windowsUserSha256 = await sha256File(windowsUserSetup.filePath);
	const windowsSystemSha256 = await sha256File(windowsSystemSetup.filePath);

	/** @type {Record<string, { version: string; productVersion: string; url: string; sha256hash?: string }>} */
	const payloadByPlatform = {
		'linux-x64': {
			version: commit,
			productVersion: version,
			url: assetUrl(linuxTar.name)
		},
		'darwin': {
			version: commit,
			productVersion: version,
			url: assetUrl(darwinX64Zip.name)
		},
		'darwin-arm64': {
			version: commit,
			productVersion: version,
			url: assetUrl(darwinArm64Zip.name)
		},
		'win32-x64': {
			version: commit,
			productVersion: version,
			url: assetUrl(windowsSystemSetup.name),
			sha256hash: windowsSystemSha256
		},
		'win32-x64-user': {
			version: commit,
			productVersion: version,
			url: assetUrl(windowsUserSetup.name),
			sha256hash: windowsUserSha256
		},
		'win32-x64-archive': {
			version: commit,
			productVersion: version,
			url: assetUrl(windowsArchiveZip.name)
		}
	};

	const historyPath = path.join(existingFeedDir, 'api', 'update', 'hcode-history.json');
	const existingHistory = await readJsonIfExists(historyPath, { commits: [] });
	const existingCommits = Array.isArray(existingHistory.commits)
		? existingHistory.commits.filter(item => typeof item === 'string' && item.length > 0)
		: [];

	const commitSet = new Set([...existingCommits, commit]);
	const commits = [...commitSet];
	if (commits.length > maxHistory) {
		commits.splice(0, commits.length - maxHistory);
	}

	for (const [platform, payload] of Object.entries(payloadByPlatform)) {
		for (const listedCommit of commits) {
			const updatePath = path.join(outputDir, 'api', 'update', platform, quality, listedCommit);
			if (listedCommit === commit) {
				await writeRaw(updatePath, '{}\n');
			} else {
				await writeJson(updatePath, payload);
			}
		}
	}

	await writeJson(path.join(outputDir, 'api', 'update', 'hcode-history.json'), {
		quality,
		latestCommit: commit,
		latestVersion: version,
		latestTag: tag,
		updatedAt: new Date().toISOString(),
		commits
	});

	await writeJson(path.join(outputDir, 'api', 'update', 'latest.json'), {
		quality,
		commit,
		version,
		tag
	});

	await writeRaw(path.join(outputDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>HCode Update Feed</title><h1>HCode Update Feed</h1>\n');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
