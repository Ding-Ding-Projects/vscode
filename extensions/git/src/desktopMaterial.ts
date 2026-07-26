/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type DesktopMaterialResolutionFailureReason =
	| 'configuredPathNotAbsolute'
	| 'configuredPathIsCommandScript'
	| 'configuredPathNotFound'
	| 'notDetected';

export type DesktopMaterialExecutableResolution =
	| { readonly ok: true; readonly executablePath: string; readonly source: 'configured' | 'detected' }
	| { readonly ok: false; readonly reason: DesktopMaterialResolutionFailureReason; readonly configuredPath?: string };

export interface DesktopMaterialLaunchSpec {
	readonly executablePath: string;
	readonly args: readonly [string];
}

export interface DesktopMaterialChildProcess {
	once(event: 'error', listener: (error: Error) => void): this;
	once(event: 'spawn', listener: () => void): this;
	unref(): void;
}

export type DesktopMaterialSpawn = (executablePath: string, args: string[], options: cp.SpawnOptions) => DesktopMaterialChildProcess;

function getPathApi(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
	return platform === 'win32' ? path.win32 : path.posix;
}

function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

export function getWindowsDesktopMaterialInstallationPaths(localAppData: string): { readonly markerPath: string; readonly executablePath: string } {
	const installationRoot = path.win32.join(localAppData, 'GitHubDesktop');
	return {
		markerPath: path.win32.join(installationRoot, 'bin', 'desktop-material.bat'),
		executablePath: path.win32.join(installationRoot, 'GitHubDesktop.exe')
	};
}

export function resolveDesktopMaterialExecutable(
	configuredPath: string | null | undefined,
	platform: NodeJS.Platform = process.platform,
	localAppData: string | undefined = process.env.LOCALAPPDATA,
	isFileFn: (filePath: string) => boolean = isFile
): DesktopMaterialExecutableResolution {
	const trimmedConfiguredPath = configuredPath?.trim();
	if (trimmedConfiguredPath) {
		const pathApi = getPathApi(platform);
		if (!pathApi.isAbsolute(trimmedConfiguredPath)) {
			return { ok: false, reason: 'configuredPathNotAbsolute', configuredPath: trimmedConfiguredPath };
		}

		const extension = pathApi.extname(trimmedConfiguredPath).toLowerCase();
		if (extension === '.bat' || extension === '.cmd') {
			return { ok: false, reason: 'configuredPathIsCommandScript', configuredPath: trimmedConfiguredPath };
		}

		if (!isFileFn(trimmedConfiguredPath)) {
			return { ok: false, reason: 'configuredPathNotFound', configuredPath: trimmedConfiguredPath };
		}

		return { ok: true, executablePath: trimmedConfiguredPath, source: 'configured' };
	}

	if (platform !== 'win32' || !localAppData) {
		return { ok: false, reason: 'notDetected' };
	}

	const installationPaths = getWindowsDesktopMaterialInstallationPaths(localAppData);
	if (!isFileFn(installationPaths.markerPath) || !isFileFn(installationPaths.executablePath)) {
		return { ok: false, reason: 'notDetected' };
	}

	return { ok: true, executablePath: installationPaths.executablePath, source: 'detected' };
}

export function createDesktopMaterialLaunchSpec(
	executablePath: string,
	repositoryRoot: string,
	platform: NodeJS.Platform = process.platform
): DesktopMaterialLaunchSpec {
	const absoluteRepositoryRoot = getPathApi(platform).resolve(repositoryRoot);
	return {
		executablePath,
		args: [`--cli-open=${absoluteRepositoryRoot}`]
	};
}

export function launchDesktopMaterial(
	launchSpec: DesktopMaterialLaunchSpec,
	spawnProcess: DesktopMaterialSpawn = cp.spawn
): Promise<void> {
	return new Promise((resolve, reject) => {
		let childProcess: DesktopMaterialChildProcess;
		try {
			childProcess = spawnProcess(launchSpec.executablePath, [...launchSpec.args], {
				detached: true,
				shell: false,
				stdio: 'ignore',
				windowsHide: true
			});
		} catch (error) {
			reject(error);
			return;
		}

		childProcess.once('error', reject);
		childProcess.once('spawn', () => {
			childProcess.unref();
			resolve();
		});
	});
}
