/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { getActiveDocument, getActiveWindow, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { IMarkdownString, MarkdownStringTrustedOptions } from '../../../../base/common/htmlContent.js';
import { mnemonicButtonLabel } from '../../../../base/common/labels.js';
import { parseLinkedText } from '../../../../base/common/linkedText.js';
import { DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import Severity from '../../../../base/common/severity.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { AbstractDialogHandler, DialogType, IAsyncPromptResult, ICheckbox, IConfirmation, IConfirmationResult, ICustomDialogOptions, IInput, IInputResult, IPrompt } from '../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, IPromptChoice, NotificationPriority } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

interface INotificationDialogResult {
	readonly button: number;
	readonly checkboxChecked?: boolean;
}

/**
 * Presents dialog decisions as actionable, urgent notifications. The work that
 * requested the decision still awaits a result, but the rest of the workbench
 * remains available and every action can be reached with the keyboard.
 */
export class NotificationDialogHandler extends AbstractDialogHandler {

	private static readonly BLOCK_MARKDOWN_ELEMENTS = new Set(['BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'OL', 'P', 'PRE', 'TABLE', 'TR', 'UL']);

	constructor(
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
	}

	async prompt<T>(prompt: IPrompt<T>): Promise<IAsyncPromptResult<T>> {
		this.logService.trace('DialogService#prompt (notification)', prompt.message);
		if (!prompt.buttons?.length && !prompt.cancelButton && !prompt.checkbox) {
			const severity = this.getNotificationSeverity(prompt.type);
			this.notificationService.notify({
				severity,
				message: this.getNotificationMessage(prompt.title, prompt.message, prompt.detail, undefined, undefined, typeof prompt.custom === 'object' ? prompt.custom : undefined),
				sticky: severity === Severity.Warning || severity === Severity.Error,
				priority: severity === Severity.Info ? NotificationPriority.DEFAULT : NotificationPriority.URGENT
			});

			return {};
		}

		const buttons = this.getPromptButtons(prompt);
		const result = await this.showNotification(
			prompt.type,
			prompt.title,
			prompt.message,
			prompt.detail,
			buttons,
			prompt.cancelButton ? buttons.length - 1 : -1,
			prompt.checkbox,
			typeof prompt.custom === 'object' ? prompt.custom : undefined,
			prompt.token
		);

		return this.getPromptResult(prompt, result.button, result.checkboxChecked);
	}

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.logService.trace('DialogService#confirm (notification)', confirmation.message);

		const buttons = this.getConfirmationButtons(confirmation);
		const result = await this.showNotification(
			confirmation.type ?? 'question',
			confirmation.title,
			confirmation.message,
			confirmation.detail,
			buttons,
			buttons.length - 1,
			confirmation.checkbox,
			typeof confirmation.custom === 'object' ? confirmation.custom : undefined,
			confirmation.token
		);

		return { confirmed: result.button === 0, checkboxChecked: result.checkboxChecked };
	}

	async input(input: IInput): Promise<IInputResult> {
		this.logService.trace('DialogService#input (quick input)', input.message);

		if (input.token?.isCancellationRequested) {
			return { confirmed: false, checkboxChecked: input.checkbox?.checked };
		}

		const values: string[] = [];
		for (let index = 0; index < input.inputs.length; index++) {
			const element = input.inputs[index];
			const sequence = input.inputs.length > 1 ? localize('notificationDialog.inputStep', "{0} ({1} of {2})", input.title ?? input.message, index + 1, input.inputs.length) : input.title ?? input.message;
			const value = await this.quickInputService.input({
				title: sequence,
				value: element.value,
				prompt: input.detail,
				placeHolder: element.placeholder,
				password: element.type === 'password',
				ignoreFocusLost: true
			}, input.token);

			if (value === undefined) {
				return { confirmed: false, checkboxChecked: input.checkbox?.checked };
			}

			values.push(value);
		}

		if (!input.checkbox && input.inputs.length > 0) {
			return { confirmed: true, values };
		}

		const buttons = this.getInputButtons(input);
		const result = await this.showNotification(
			input.type ?? 'question',
			input.title,
			input.message,
			input.detail,
			buttons,
			buttons.length - 1,
			input.checkbox,
			typeof input.custom === 'object' ? input.custom : undefined,
			input.token
		);

		return result.button === 0
			? { confirmed: true, checkboxChecked: result.checkboxChecked, values }
			: { confirmed: false, checkboxChecked: result.checkboxChecked };
	}

	async about(title: string, details: string, detailsToCopy: string): Promise<void> {
		const result = await this.showNotification(
			Severity.Info,
			undefined,
			title,
			details,
			[
				localize({ key: 'copy', comment: ['&& denotes a mnemonic'] }, "&&Copy"),
				localize('ok', "OK")
			],
			1
		);

		if (result.button === 0) {
			await this.clipboardService.writeText(detailsToCopy);
		}
	}

	private showNotification(
		type: Severity | DialogType | undefined,
		title: string | undefined,
		message: string,
		detail: string | undefined,
		buttons: readonly string[],
		cancelId: number,
		checkbox?: ICheckbox,
		custom?: ICustomDialogOptions,
		token?: CancellationToken
	): Promise<INotificationDialogResult> {
		let checkboxChecked = checkbox?.checked;

		if (token?.isCancellationRequested) {
			return Promise.resolve({ button: cancelId, checkboxChecked });
		}

		return new Promise(resolve => {
			const disposables = new DisposableStore();
			const closeListener = disposables.add(new MutableDisposable<IDisposable>());
			const focusScheduler = disposables.add(new MutableDisposable<IDisposable>());
			let completed = false;
			let cancellationRequested = false;
			let currentHandle: INotificationHandle | undefined;

			const complete = (button: number) => {
				if (completed) {
					return;
				}

				completed = true;
				disposables.dispose();
				resolve({ button, checkboxChecked });
			};

			const choices: IPromptChoice[] = buttons.map((button, index) => ({
				label: this.getNotificationButtonLabel(button),
				run: () => complete(index)
			}));

			if (checkbox) {
				choices.push({
					label: localize('notificationDialog.toggleOption', "Toggle: {0}", checkbox.label),
					keepOpen: true,
					run: () => {
						checkboxChecked = !checkboxChecked;
						currentHandle?.updateMessage(this.getNotificationMessage(title, message, detail, checkbox, checkboxChecked, custom, buttons));
					}
				});
			}

			const show = () => {
				if (completed) {
					return;
				}

				const handle = currentHandle = this.notificationService.prompt(
					this.getNotificationSeverity(type),
					this.getNotificationMessage(title, message, detail, checkbox, checkboxChecked, custom, buttons),
					choices,
					{ sticky: true, priority: NotificationPriority.URGENT }
				);

				closeListener.value = handle.onDidClose(() => {
					currentHandle = undefined;
					if (custom?.disableCloseAction && !cancellationRequested) {
						// Notifications do not have a hideable close affordance. Re-show a
						// non-dismissible decision after an attempted dismissal so callers
						// that require an explicit choice cannot be left unresolved.
						focusScheduler.value = scheduleAtNextAnimationFrame(getActiveWindow(), show);
						return;
					}

					complete(cancelId);
				});

				// Toast rendering follows the model update. Waiting one frame ensures the
				// actionable list exists before moving focus away from the invoking surface.
				focusScheduler.value = scheduleAtNextAnimationFrame(getActiveWindow(), () => {
					this.focusNotification();
				});
			};

			if (token) {
				disposables.add(token.onCancellationRequested(() => {
					cancellationRequested = true;
					if (currentHandle) {
						currentHandle.close();
					} else {
						complete(cancelId);
					}
				}));
			}

			show();
		});
	}

	private getNotificationSeverity(type: Severity | DialogType | undefined): Severity {
		if (typeof type === 'number') {
			return type === Severity.Error || type === Severity.Warning ? type : Severity.Info;
		}

		switch (type) {
			case 'error': return Severity.Error;
			case 'warning': return Severity.Warning;
			default: return Severity.Info;
		}
	}

	private async focusNotification(): Promise<void> {
		try {
			if (await this.commandService.executeCommand<boolean>('notifications.focusToasts')) {
				return;
			}
		} catch (error) {
			this.logService.trace('Unable to focus notification dialog toast', error);
		}

		// The center suppresses toasts while open, and burst protection can omit a
		// toast entirely. Showing the center always exposes and focuses the newest
		// model item, keeping the decision keyboard reachable in both cases.
		try {
			await this.commandService.executeCommand('notifications.showList');
		} catch (error) {
			this.logService.trace('Unable to focus notification dialog in notification center', error);
		}
	}

	private getNotificationButtonLabel(label: string): string {
		return mnemonicButtonLabel(label, true);
	}

	private getNotificationMessage(title: string | undefined, message: string, detail: string | undefined, checkbox: ICheckbox | undefined, checkboxChecked: boolean | undefined, custom: ICustomDialogOptions | undefined, buttons?: readonly string[]): string {
		const parts = [title, message, detail]
			.filter((part): part is string => !!part)
			.map(part => this.getPlainNotificationText(part));
		if (buttons && custom?.buttonDetails) {
			for (let index = 0; index < buttons.length; index++) {
				const buttonDetail = custom.buttonDetails[index];
				if (buttonDetail) {
					parts.push(localize(
						'notificationDialog.actionDetail',
						"Action {0}: {1}",
						this.getNotificationButtonLabel(buttons[index]),
						this.getPlainNotificationText(buttonDetail)
					));
				}
			}
		}
		parts.push(...(custom?.markdownDetails?.map(value => this.getMarkdownNotificationText(value.markdown, !value.actionHandler)) ?? []));

		if (checkbox) {
			parts.push(this.getPlainNotificationText(checkboxChecked
				? localize('notificationDialog.optionEnabled', "Option enabled: {0}", checkbox.label)
				: localize('notificationDialog.optionDisabled', "Option disabled: {0}", checkbox.label)));
		}

		return parts.filter(Boolean).join('\n\n');
	}

	/**
	 * Dialog title/message/detail strings are plain text. Notifications normally
	 * recognize Markdown-style links, including command URIs, so reduce any such
	 * syntax to its visible label before handing the text to the notification UI.
	 */
	private getPlainNotificationText(value: string): string {
		return parseLinkedText(value).toString();
	}

	private getMarkdownNotificationText(markdown: IMarkdownString, allowLinks: boolean): string {
		const rendered = renderMarkdown(markdown, {
			codeBlockRendererSync: (_languageId, value) => {
				const code = getActiveDocument().createElement('span');
				code.textContent = value;
				return code;
			}
		});

		try {
			return this.getRenderedMarkdownText(rendered.element, allowLinks, markdown.isTrusted);
		} finally {
			rendered.dispose();
		}
	}

	private getRenderedMarkdownText(root: HTMLElement, allowLinks: boolean, trust: boolean | MarkdownStringTrustedOptions | undefined): string {
		const parts: string[] = [];
		const appendSeparator = () => {
			if (parts.length && !parts[parts.length - 1].endsWith('\n')) {
				parts.push('\n');
			}
		};
		const visit = (node: Node): void => {
			if (node.nodeType === 3 /* Node.TEXT_NODE */) {
				parts.push(this.getPlainNotificationText(node.nodeValue ?? ''));
				return;
			}
			if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) {
				return;
			}

			const element = node as HTMLElement;
			if (element.tagName === 'BR') {
				appendSeparator();
				return;
			}
			if (element.tagName === 'A') {
				const label = this.getPlainNotificationText(element.textContent ?? '');
				const href = element.dataset.href;
				if (href && allowLinks && this.isAllowedMarkdownLink(href, trust) && !label.includes(']') && !/[\s)]/.test(href)) {
					parts.push(`[${label}](${href})`);
				} else {
					parts.push(label);
				}
				return;
			}

			const block = NotificationDialogHandler.BLOCK_MARKDOWN_ELEMENTS.has(element.tagName);
			if (block) {
				appendSeparator();
			}
			for (const child of element.childNodes) {
				visit(child);
			}
			if (block) {
				appendSeparator();
			}
		};

		visit(root);
		return parts.join('').replace(/[ \t]+\n/g, '\n').trim();
	}

	private isAllowedMarkdownLink(href: string, trust: boolean | MarkdownStringTrustedOptions | undefined): boolean {
		let uri: URI;
		try {
			uri = URI.parse(href);
		} catch {
			return false;
		}

		switch (uri.scheme.toLowerCase()) {
			case Schemas.http:
			case Schemas.https:
			case Schemas.file:
				return true;
			case Schemas.command:
				return trust === true || (typeof trust === 'object' && trust.enabledCommands?.includes(uri.path) === true);
			default:
				return false;
		}
	}
}
