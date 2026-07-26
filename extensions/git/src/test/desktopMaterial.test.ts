/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { EventEmitter } from 'events';
import { createDesktopMaterialLaunchSpec, type DesktopMaterialChildProcess, type DesktopMaterialSpawn, getWindowsDesktopMaterialInstallationPaths, launchDesktopMaterial, resolveDesktopMaterialExecutable } from '../desktopMaterial';

class TestChildProcess extends EventEmitter implements DesktopMaterialChildProcess {
	unrefCalled = false;

	unref(): void {
		this.unrefCalled = true;
	}
}

suite('Desktop Material', () => {
	test('detects only a branded Windows installation', () => {
		const localAppData = 'C:\\Users\\Ada\\AppData\\Local';
		const installationPaths = getWindowsDesktopMaterialInstallationPaths(localAppData);
		const existingFiles = new Set([installationPaths.markerPath, installationPaths.executablePath]);

		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(undefined, 'win32', localAppData, candidate => existingFiles.has(candidate)),
			{ ok: true, executablePath: installationPaths.executablePath, source: 'detected' }
		);

		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(undefined, 'win32', localAppData, candidate => candidate === installationPaths.executablePath),
			{ ok: false, reason: 'notDetected' }
		);

		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(undefined, 'win32', localAppData, candidate => candidate === installationPaths.markerPath),
			{ ok: false, reason: 'notDetected' }
		);

		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(undefined, 'linux', localAppData, () => true),
			{ ok: false, reason: 'notDetected' }
		);
	});

	test('uses a configured direct executable on non-Windows platforms', () => {
		const configuredPath = '/opt/desktop material/desktop-material';
		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(configuredPath, 'linux', undefined, candidate => candidate === configuredPath),
			{ ok: true, executablePath: configuredPath, source: 'configured' }
		);
	});

	test('rejects relative, missing, and command-script configuration paths', () => {
		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable('desktop-material', 'linux', undefined, () => true),
			{ ok: false, reason: 'configuredPathNotAbsolute', configuredPath: 'desktop-material' }
		);

		const commandScriptPath = 'C:\\Tools\\desktop-material.CMD';
		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(commandScriptPath, 'win32', undefined, () => true),
			{ ok: false, reason: 'configuredPathIsCommandScript', configuredPath: commandScriptPath }
		);

		const batchScriptPath = 'C:\\Tools\\desktop-material.bat';
		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(batchScriptPath, 'win32', undefined, () => true),
			{ ok: false, reason: 'configuredPathIsCommandScript', configuredPath: batchScriptPath }
		);

		const missingPath = '/opt/desktop-material';
		assert.deepStrictEqual(
			resolveDesktopMaterialExecutable(missingPath, 'linux', undefined, () => false),
			{ ok: false, reason: 'configuredPathNotFound', configuredPath: missingPath }
		);
	});

	test('keeps a repository path with spaces in one exact CLI argument', () => {
		const launchSpec = createDesktopMaterialLaunchSpec(
			'C:\\Program Files\\Desktop Material\\DesktopMaterial.exe',
			'C:\\Work Trees\\material repo',
			'win32'
		);

		assert.deepStrictEqual(launchSpec, {
			executablePath: 'C:\\Program Files\\Desktop Material\\DesktopMaterial.exe',
			args: ['--cli-open=C:\\Work Trees\\material repo']
		});
	});

	test('launches detached without a command shell', async () => {
		const launchSpec = createDesktopMaterialLaunchSpec('/opt/desktop material/desktop-material', '/work trees/repo', 'linux');
		const childProcess = new TestChildProcess();
		let actualExecutablePath: string | undefined;
		let actualArgs: string[] | undefined;
		let actualOptions: Parameters<DesktopMaterialSpawn>[2] | undefined;

		const spawnProcess: DesktopMaterialSpawn = (executablePath, args, options) => {
			actualExecutablePath = executablePath;
			actualArgs = args;
			actualOptions = options;
			queueMicrotask(() => childProcess.emit('spawn'));
			return childProcess;
		};

		await launchDesktopMaterial(launchSpec, spawnProcess);

		assert.strictEqual(actualExecutablePath, launchSpec.executablePath);
		assert.deepStrictEqual(actualArgs, [...launchSpec.args]);
		assert.strictEqual(actualOptions?.detached, true);
		assert.strictEqual(actualOptions?.shell, false);
		assert.strictEqual(actualOptions?.stdio, 'ignore');
		assert.strictEqual(actualOptions?.windowsHide, true);
		assert.strictEqual(childProcess.unrefCalled, true);
	});

	test('reports a process launch failure', async () => {
		const launchError = new Error('launch failed');
		const childProcess = new TestChildProcess();
		const spawnProcess: DesktopMaterialSpawn = () => {
			queueMicrotask(() => childProcess.emit('error', launchError));
			return childProcess;
		};

		await assert.rejects(
			launchDesktopMaterial(createDesktopMaterialLaunchSpec('/opt/desktop-material', '/repo', 'linux'), spawnProcess),
			error => error === launchError
		);
		assert.strictEqual(childProcess.unrefCalled, false);
	});
});
