/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getActiveWindow } from '../../../../../base/browser/dom.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import Severity from '../../../../../base/common/severity.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestClipboardService } from '../../../../../platform/clipboard/test/common/testClipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { NotificationPriority } from '../../../../../platform/notification/common/notification.js';
import { IInputOptions, IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { NotificationDialogHandler } from '../../../../browser/parts/dialogs/notificationDialogHandler.js';
import { DialogsModel } from '../../../../common/dialogs.js';
import { INotificationViewItem } from '../../../../common/notifications.js';
import { NotificationService } from '../../../../services/notification/common/notificationService.js';
import { TestStorageService } from '../../../common/workbenchTestServices.js';

interface IRecordedInput {
	readonly options: IInputOptions | undefined;
	readonly token: CancellationToken | undefined;
}

class RecordingQuickInputService extends mock<IQuickInputService>() {
	readonly answers: (string | undefined)[] = [];
	readonly calls: IRecordedInput[] = [];
	override readonly onShow = Event.None;
	override readonly onHide = Event.None;

	override async input(options?: IInputOptions, token?: CancellationToken): Promise<string | undefined> {
		this.calls.push({ options, token });
		return this.answers.shift();
	}
}

class RecordingCommandService extends mock<ICommandService>() {
	readonly calls: string[] = [];
	focusToastsResult = true;

	override async executeCommand<T>(commandId: string): Promise<T> {
		this.calls.push(commandId);
		return (commandId === 'notifications.focusToasts' ? this.focusToastsResult : undefined) as T;
	}
}

suite('NotificationDialogHandler', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let notificationService: NotificationService;
	let quickInputService: RecordingQuickInputService;
	let clipboardService: TestClipboardService;
	let commandService: RecordingCommandService;
	let handler: NotificationDialogHandler;

	setup(() => {
		const storageService = disposables.add(new TestStorageService());
		notificationService = disposables.add(new NotificationService(storageService));
		quickInputService = new RecordingQuickInputService();
		clipboardService = new TestClipboardService();
		commandService = new RecordingCommandService();
		handler = new NotificationDialogHandler(disposables.add(new NullLogService()), notificationService, quickInputService, clipboardService, commandService);
	});

	function onlyNotification(): INotificationViewItem {
		assert.strictEqual(notificationService.model.notifications.length, 1);
		return notificationService.model.notifications[0];
	}

	async function runPrimary(item: INotificationViewItem, index: number): Promise<void> {
		const action = item.actions?.primary?.[index];
		assert.ok(action);
		await action.run();
	}

	test('confirm maps actions, checkbox state, and dismissal', async () => {
		const confirmPromise = handler.confirm({
			type: Severity.Warning,
			title: 'Safety check',
			message: 'Continue?',
			detail: 'Nothing runs until a choice is made.',
			primaryButton: '&&Continue',
			cancelButton: '&&Cancel',
			checkbox: { label: 'Remember this choice' }
		});

		const item = onlyNotification();
		assert.strictEqual(item.severity, Severity.Warning);
		assert.strictEqual(item.sticky, true);
		assert.strictEqual(item.priority, NotificationPriority.URGENT);
		assert.strictEqual(item.message.raw.includes('Safety check\n\nContinue?'), true);
		assert.deepStrictEqual(item.actions?.primary?.map(action => action.label), ['Continue', 'Cancel', 'Toggle: Remember this choice']);
		await new Promise<void>(resolve => getActiveWindow().requestAnimationFrame(() => resolve()));
		assert.deepStrictEqual(commandService.calls, ['notifications.focusToasts']);

		await runPrimary(item, 2);
		assert.strictEqual(item.message.raw.includes('Option enabled: Remember this choice'), true);
		await runPrimary(item, 0);
		assert.deepStrictEqual(await confirmPromise, { confirmed: true, checkboxChecked: true });

		const dismissedPromise = handler.confirm({ message: 'Dismiss me' });
		onlyNotification().close();
		assert.deepStrictEqual(await dismissedPromise, { confirmed: false, checkboxChecked: undefined });
	});

	test('falls back to the notification center and keeps action details out of labels', async () => {
		commandService.focusToastsResult = false;
		const detail = 'Use Restricted Mode to review this workspace without running untrusted code.';
		const resultPromise = handler.confirm({
			message: 'Choose how to open this workspace',
			primaryButton: '&&Trust',
			cancelButton: 'Browse in &&Restricted Mode',
			custom: { buttonDetails: ['Enable all workspace features.', detail] }
		});

		const item = onlyNotification();
		assert.deepStrictEqual(item.actions?.primary?.map(action => action.label), ['Trust', 'Browse in Restricted Mode']);
		assert.strictEqual(item.message.raw.includes('Action Trust: Enable all workspace features.'), true);
		assert.strictEqual(item.message.raw.includes(`Action Browse in Restricted Mode: ${detail}`), true);

		await new Promise<void>(resolve => getActiveWindow().requestAnimationFrame(() => resolve()));
		await Promise.resolve();
		assert.deepStrictEqual(commandService.calls, ['notifications.focusToasts', 'notifications.showList']);

		await runPrimary(item, 1);
		assert.deepStrictEqual(await resultPromise, { confirmed: false, checkboxChecked: undefined });
	});

	test('prompt returns async choices and custom cancellation on close', async () => {
		const selectedPromise = handler.prompt({
			message: 'Pick one',
			buttons: [
				{ label: 'First', run: () => Promise.resolve('first') },
				{ label: 'Second', run: async () => 'second' }
			],
			cancelButton: true
		});
		await runPrimary(onlyNotification(), 1);
		const selected = await selectedPromise;
		assert.strictEqual(await selected.result, 'second');

		let cancelRuns = 0;
		const cancelledPromise = handler.prompt({
			message: 'Close to cancel',
			buttons: [{ label: 'Continue', run: () => 'continued' }],
			cancelButton: {
				label: 'Stop',
				run: () => {
					cancelRuns++;
					return 'cancelled';
				}
			}
		});
		onlyNotification().close();
		const cancelled = await cancelledPromise;
		assert.strictEqual(await cancelled.result, 'cancelled');
		assert.strictEqual(cancelRuns, 1);
	});

	test('cancellation token closes a decision exactly once', async () => {
		const source = disposables.add(new CancellationTokenSource());
		let cancelRuns = 0;
		const resultPromise = handler.prompt({
			message: 'Token controlled',
			buttons: [{ label: 'Continue', run: () => 'continued' }],
			cancelButton: { run: () => {
				cancelRuns++;
				return 'cancelled';
			} },
			custom: { disableCloseAction: true },
			token: source.token
		});

		source.cancel();
		const result = await resultPromise;
		assert.strictEqual(await result.result, 'cancelled');
		assert.strictEqual(cancelRuns, 1);
		assert.strictEqual(notificationService.model.notifications.length, 0);
	});

	test('non-dismissible decisions survive dismissal until an explicit action', async () => {
		let restrictedModeRuns = 0;
		let settled = false;
		const resultPromise = handler.prompt({
			message: 'Do you trust the authors of this workspace?',
			buttons: [
				{ label: 'Trust', run: () => true },
				{ label: 'Browse in Restricted Mode', run: () => {
					restrictedModeRuns++;
					return false;
				} }
			],
			custom: { disableCloseAction: true }
		});
		resultPromise.then(() => settled = true);

		const dismissed = onlyNotification();
		dismissed.close();
		await new Promise<void>(resolve => getActiveWindow().requestAnimationFrame(() => resolve()));

		assert.strictEqual(settled, false);
		const replacement = onlyNotification();
		assert.notStrictEqual(replacement, dismissed);
		await runPrimary(replacement, 1);

		const result = await resultPromise;
		assert.strictEqual(await result.result, false);
		assert.strictEqual(restrictedModeRuns, 1);
	});

	test('notification text preserves Markdown command trust boundaries', async () => {
		const trustedSubset = new MarkdownString('[Allowed](command:allowed) [Blocked](command:blocked)', {
			isTrusted: { enabledCommands: ['allowed'] }
		});
		const code = new MarkdownString();
		code.appendCodeblock('text', '[Code](command:allowed)');
		code.isTrusted = true;

		const resultPromise = handler.confirm({
			message: 'Plain [Plain](command:plain)',
			detail: 'Docs [site](https://example.com)',
			custom: {
				markdownDetails: [
					{ markdown: new MarkdownString('[Untrusted](command:untrusted) [Web](https://example.com)') },
					{ markdown: trustedSubset },
					{ markdown: code }
				]
			}
		});

		const item = onlyNotification();
		const links = item.message.linkedText.nodes.flatMap(node => typeof node === 'string' ? [] : [{ label: node.label, href: node.href }]);
		assert.deepStrictEqual(links, [
			{ label: 'Web', href: 'https://example.com' },
			{ label: 'Allowed', href: 'command:allowed' }
		]);
		assert.strictEqual(item.message.raw.includes('Plain Plain'), true);
		assert.strictEqual(item.message.raw.includes('Docs site'), true);
		assert.strictEqual(item.message.raw.includes('Untrusted'), true);
		assert.strictEqual(item.message.raw.includes('Blocked'), true);
		assert.strictEqual(item.message.raw.includes('Code'), true);

		await runPrimary(item, 1);
		assert.deepStrictEqual(await resultPromise, { confirmed: false, checkboxChecked: undefined });
	});

	test('buttonless information resolves immediately and warnings persist', async () => {
		const info = await handler.prompt({ type: Severity.Info, message: 'FYI' });
		assert.strictEqual(info.result, undefined);
		let item = onlyNotification();
		assert.strictEqual(item.actions?.primary?.length ?? 0, 0);
		assert.strictEqual(item.actions?.secondary?.length ?? 0, 0);
		assert.strictEqual(item.sticky, false);
		item.close();

		const warning = await handler.prompt({ type: Severity.Warning, message: 'Take care' });
		assert.strictEqual(warning.result, undefined);
		item = onlyNotification();
		assert.strictEqual(item.sticky, true);
		assert.strictEqual(item.priority, NotificationPriority.URGENT);
		item.close();
	});

	test('input uses ordered Quick Input fields and masks passwords', async () => {
		quickInputService.answers.push('alice', 'secret');
		const source = disposables.add(new CancellationTokenSource());
		const result = await handler.input({
			message: 'Proxy credentials',
			detail: 'Enter credentials for the proxy.',
			inputs: [
				{ value: 'default user', placeholder: 'Username' },
				{ type: 'password', placeholder: 'Password' }
			],
			token: source.token
		});

		assert.deepStrictEqual(result, { confirmed: true, values: ['alice', 'secret'] });
		assert.strictEqual(quickInputService.calls.length, 2);
		assert.strictEqual(quickInputService.calls[0].options?.value, 'default user');
		assert.strictEqual(quickInputService.calls[0].options?.password, false);
		assert.strictEqual(quickInputService.calls[1].options?.password, true);
		assert.strictEqual(quickInputService.calls[1].token, source.token);
	});

	test('input cancellation returns no partial values', async () => {
		quickInputService.answers.push('partial', undefined);
		const result = await handler.input({
			message: 'Two fields',
			inputs: [{ placeholder: 'One' }, { placeholder: 'Two' }, { placeholder: 'Three' }]
		});

		assert.deepStrictEqual(result, { confirmed: false, checkboxChecked: undefined });
		assert.strictEqual(quickInputService.calls.length, 2);
	});

	test('about copies only through its Copy action', async () => {
		const aboutPromise = handler.about('Code - OSS', 'Version 1', 'copy payload');
		await runPrimary(onlyNotification(), 0);
		await aboutPromise;
		assert.strictEqual(await clipboardService.readText(), 'copy payload');

		await clipboardService.writeText('unchanged');
		const dismissPromise = handler.about('Code - OSS', 'Version 1', 'new payload');
		onlyNotification().close();
		await dismissPromise;
		assert.strictEqual(await clipboardService.readText(), 'unchanged');
	});
});

suite('DialogsModel notification lifecycle', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('non-modal queue entries do not emit modal lifecycle events', async () => {
		const model = disposables.add(new DialogsModel());
		let added = 0;
		let willShowModal = 0;
		let didShowModal = 0;
		disposables.add(model.onDidAddDialog(() => added++));
		disposables.add(model.onWillShowDialog(() => willShowModal++));
		disposables.add(model.onDidShowDialog(() => didShowModal++));

		const notification = model.show({ modal: false, confirmArgs: { confirmation: { message: 'Notification' } } });
		assert.deepStrictEqual({ added, willShowModal, didShowModal }, { added: 1, willShowModal: 0, didShowModal: 0 });
		notification.item.close({ confirmed: false });
		await notification.result;
		assert.deepStrictEqual({ added, willShowModal, didShowModal }, { added: 1, willShowModal: 0, didShowModal: 0 });

		const modal = model.show({ confirmArgs: { confirmation: { message: 'Modal' } } });
		assert.deepStrictEqual({ added, willShowModal, didShowModal }, { added: 2, willShowModal: 1, didShowModal: 0 });
		modal.item.close({ confirmed: false });
		await modal.result;
		assert.deepStrictEqual({ added, willShowModal, didShowModal }, { added: 2, willShowModal: 1, didShowModal: 1 });
	});
});
