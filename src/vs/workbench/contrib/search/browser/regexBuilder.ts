/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { IKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { Toggle } from '../../../../base/browser/ui/toggle/toggle.js';
import { Delayer } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IWebWorkerClient } from '../../../../base/common/worker/webWorker.js';
import * as nls from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { defaultButtonStyles, defaultToggleStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { WebWorkerDescriptor } from '../../../../platform/webWorker/browser/webWorkerDescriptor.js';
import { IWebWorkerService } from '../../../../platform/webWorker/browser/webWorkerService.js';
import {
	createRegexBuilderExpression,
	escapeRegexLiteral,
	getSupportedRegexBuilderFlags,
	insertRegexFragment,
	IRegexBuilderMatch,
	IRegexBuilderResult,
	IRegexBuilderWorker,
	REGEX_BUILDER_MAX_CAPTURE_RECORDS,
	REGEX_BUILDER_MAX_PATTERN_LENGTH,
	REGEX_BUILDER_MAX_SAMPLE_LENGTH,
	RegexBuilderFlag,
} from '../common/regexBuilder.js';

const REGEX_BUILDER_EVALUATION_DELAY = 120;
const REGEX_BUILDER_EVALUATION_TIMEOUT = 250;
const REGEX_BUILDER_DISPLAY_VALUE_LIMIT = 160;

export interface ISearchRegexBuilderState {
	readonly query: string;
	readonly isRegex: boolean;
	readonly isCaseSensitive: boolean;
	readonly isWholeWords: boolean;
}

export interface ISearchRegexBuilderCallbacks {
	readonly onQueryChange: (query: string) => void;
	readonly onSearchOptionsChange: (options: Pick<ISearchRegexBuilderState, 'isRegex' | 'isCaseSensitive' | 'isWholeWords'>) => void;
	readonly onSubmitSearch: () => void;
	readonly focusSearchInput: () => void;
}

interface IGuidedFragment {
	readonly label: string;
	readonly title: string;
	readonly prefix: string;
	readonly suffix?: string;
	readonly fallback?: string;
}

let regexBuilderIdPool = 0;

export class SearchRegexBuilder extends Disposable {
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	readonly toggleControl: Toggle;
	readonly onToggleControlKeyDown: Event<IKeyboardEvent>;

	private readonly id = ++regexBuilderIdPool;
	private readonly container: HTMLElement;
	private readonly patternInput: HTMLTextAreaElement;
	private readonly literalInput: HTMLInputElement;
	private readonly sampleInput: HTMLTextAreaElement;
	private readonly regexCheckbox: HTMLInputElement;
	private readonly wholeWordsCheckbox: HTMLInputElement;
	private readonly flagCheckboxes = new Map<RegexBuilderFlag, HTMLInputElement>();
	private readonly statusNode: HTMLElement;
	private readonly matchesNode: HTMLElement;
	private readonly evaluationDelayer = this._register(new Delayer<void>(REGEX_BUILDER_EVALUATION_DELAY));
	private readonly activeWorker = this._register(new MutableDisposable<IWebWorkerClient<IRegexBuilderWorker>>());

	private state: ISearchRegexBuilderState = { query: '', isRegex: false, isCaseSensitive: false, isWholeWords: false };
	private evaluationSequence = 0;
	private isApplyingInsertion = false;

	constructor(
		parent: HTMLElement,
		private readonly callbacks: ISearchRegexBuilderCallbacks,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWebWorkerService private readonly webWorkerService: IWebWorkerService,
	) {
		super();

		const openLabel = nls.localize('search.regexBuilder.open', "Open regex builder");
		this.toggleControl = this._register(new Toggle({
			isChecked: false,
			title: openLabel,
			icon: Codicon.regex,
			actionClassName: 'search-regex-builder-toggle',
			...defaultToggleStyles,
		}));
		this._register(this.toggleControl.onChange(() => this.toggle()));
		this.onToggleControlKeyDown = this.toggleControl.onKeyDown;

		this.container = dom.append(parent, dom.$('section.search-regex-builder'));
		this.container.hidden = true;
		this.container.setAttribute('aria-hidden', 'true');
		this.container.setAttribute('aria-label', nls.localize('search.regexBuilder.region', "Regex builder"));
		this.container.setAttribute('role', 'region');

		const header = dom.append(this.container, dom.$('.search-regex-builder-header'));
		const heading = dom.append(header, dom.$('h3.search-regex-builder-heading'));
		heading.textContent = nls.localize('search.regexBuilder.heading', "Regex builder");
		const closeButton = this._register(new Button(header, { ...defaultButtonStyles, secondary: true, title: nls.localize('search.regexBuilder.close', "Close regex builder") }));
		closeButton.icon = Codicon.close;
		this._register(closeButton.onDidClick(() => this.hide(true)));

		const summary = dom.append(this.container, dom.$('p.search-regex-builder-summary'));
		summary.textContent = nls.localize(
			'search.regexBuilder.summary',
			"Build a JavaScript (ECMAScript) regular expression locally. Pattern, regular expression mode, match case, and whole word stay synchronized with Search. Other flags stay local to preview and export and are labeled with their scope."
		);

		const searchOptions = dom.append(this.container, dom.$('fieldset.search-regex-builder-options'));
		const searchOptionsLegend = dom.append(searchOptions, dom.$('legend'));
		searchOptionsLegend.textContent = nls.localize('search.regexBuilder.searchOptions', "Search options");
		this.regexCheckbox = this.createCheckbox(
			searchOptions,
			`search-regex-builder-regex-${this.id}`,
			nls.localize('search.regexBuilder.useRegex', "Use regular expression in Search"),
			() => this.updateSearchOptions()
		);
		this.wholeWordsCheckbox = this.createCheckbox(
			searchOptions,
			`search-regex-builder-whole-${this.id}`,
			nls.localize('search.regexBuilder.wholeWords', "Match whole words"),
			() => this.updateSearchOptions()
		);

		const guide = dom.append(this.container, dom.$('fieldset.search-regex-builder-guide'));
		const guideLegend = dom.append(guide, dom.$('legend'));
		guideLegend.textContent = nls.localize('search.regexBuilder.guide', "Guided construction");
		const literalRow = dom.append(guide, dom.$('.search-regex-builder-literal-row'));
		const literalId = `search-regex-builder-literal-${this.id}`;
		const literalLabel = dom.append(literalRow, dom.$('label'));
		literalLabel.setAttribute('for', literalId);
		literalLabel.textContent = nls.localize('search.regexBuilder.literal', "Literal text");
		this.literalInput = dom.append(literalRow, dom.$('input.search-regex-builder-literal')) as HTMLInputElement;
		this.literalInput.id = literalId;
		this.literalInput.type = 'text';
		this.literalInput.autocomplete = 'off';
		this.literalInput.spellcheck = false;
		const addLiteralButton = this.createButton(literalRow, nls.localize('search.regexBuilder.addLiteral', "Add literal"), () => this.insertLiteral());
		addLiteralButton.element.classList.add('search-regex-builder-add-literal');
		this._register(dom.addDisposableListener(this.literalInput, dom.EventType.KEY_DOWN, event => {
			if ((event as KeyboardEvent).key === 'Enter') {
				event.preventDefault();
				this.insertLiteral();
			}
		}));

		const fragmentGroup = dom.append(guide, dom.$('.search-regex-builder-fragments'));
		fragmentGroup.setAttribute('role', 'group');
		fragmentGroup.setAttribute('aria-label', nls.localize('search.regexBuilder.fragments', "Regular expression building blocks"));
		const fragments: readonly IGuidedFragment[] = [
			{ label: '[abc]', title: nls.localize('search.regexBuilder.characterClass', "Character class"), prefix: '[', suffix: ']', fallback: 'abc' },
			{ label: '^', title: nls.localize('search.regexBuilder.startAnchor', "Start anchor"), prefix: '^' },
			{ label: '$', title: nls.localize('search.regexBuilder.endAnchor', "End anchor"), prefix: '$' },
			{ label: '(…)', title: nls.localize('search.regexBuilder.captureGroup', "Capturing group"), prefix: '(', suffix: ')' },
			{ label: '(?:…)', title: nls.localize('search.regexBuilder.nonCaptureGroup', "Non-capturing group"), prefix: '(?:', suffix: ')' },
			{ label: '|', title: nls.localize('search.regexBuilder.alternation', "Alternation"), prefix: '|' },
			{ label: '*', title: nls.localize('search.regexBuilder.zeroOrMore', "Zero or more"), prefix: '(?:', suffix: ')*' },
			{ label: '+', title: nls.localize('search.regexBuilder.oneOrMore', "One or more"), prefix: '(?:', suffix: ')+' },
			{ label: '?', title: nls.localize('search.regexBuilder.optional', "Optional"), prefix: '(?:', suffix: ')?' },
			{ label: '{1,3}', title: nls.localize('search.regexBuilder.range', "Repeat one to three times"), prefix: '(?:', suffix: '){1,3}' },
		];
		for (const fragment of fragments) {
			const button = this.createButton(fragmentGroup, fragment.label, () => this.insertFragment(fragment));
			button.element.title = fragment.title;
			button.element.setAttribute('aria-label', fragment.title);
		}

		const patternId = `search-regex-builder-pattern-${this.id}`;
		const patternLabel = dom.append(this.container, dom.$('label.search-regex-builder-label'));
		patternLabel.setAttribute('for', patternId);
		patternLabel.textContent = nls.localize('search.regexBuilder.rawPattern', "Raw pattern");
		this.patternInput = dom.append(this.container, dom.$('textarea.search-regex-builder-pattern')) as HTMLTextAreaElement;
		this.patternInput.id = patternId;
		this.patternInput.rows = 3;
		this.patternInput.maxLength = REGEX_BUILDER_MAX_PATTERN_LENGTH + 1;
		this.patternInput.spellcheck = false;
		this.patternInput.wrap = 'off';
		this._register(dom.addDisposableListener(this.patternInput, dom.EventType.INPUT, () => {
			this.callbacks.onQueryChange(this.patternInput.value);
			this.scheduleEvaluation();
		}));
		this._register(dom.addDisposableListener(this.patternInput, dom.EventType.KEY_DOWN, event => {
			const keyboardEvent = event as KeyboardEvent;
			if (keyboardEvent.key === 'Enter' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) {
				keyboardEvent.preventDefault();
				this.callbacks.onSubmitSearch();
			}
		}));

		const flags = dom.append(this.container, dom.$('fieldset.search-regex-builder-flags'));
		const flagsLegend = dom.append(flags, dom.$('legend'));
		flagsLegend.textContent = nls.localize('search.regexBuilder.flags', "JavaScript preview and export flags");
		for (const flag of getSupportedRegexBuilderFlags()) {
			const label = this.getFlagLabel(flag);
			const checkbox = this.createCheckbox(flags, `search-regex-builder-flag-${flag}-${this.id}`, label, () => this.onFlagChanged(flag));
			checkbox.dataset.flag = flag;
			checkbox.checked = flag === 'g' || flag === 'u';
			this.flagCheckboxes.set(flag, checkbox);
		}

		const sampleId = `search-regex-builder-sample-${this.id}`;
		const sampleLabel = dom.append(this.container, dom.$('label.search-regex-builder-label'));
		sampleLabel.setAttribute('for', sampleId);
		sampleLabel.textContent = nls.localize('search.regexBuilder.sample', "Sample text (local preview only)");
		this.sampleInput = dom.append(this.container, dom.$('textarea.search-regex-builder-sample')) as HTMLTextAreaElement;
		this.sampleInput.id = sampleId;
		this.sampleInput.rows = 4;
		this.sampleInput.maxLength = REGEX_BUILDER_MAX_SAMPLE_LENGTH + 1;
		this.sampleInput.spellcheck = false;
		this._register(dom.addDisposableListener(this.sampleInput, dom.EventType.INPUT, () => this.scheduleEvaluation()));

		const actions = dom.append(this.container, dom.$('.search-regex-builder-actions'));
		this.createButton(actions, nls.localize('search.regexBuilder.runSearch', "Run search"), () => this.callbacks.onSubmitSearch(), false);
		this.createButton(actions, nls.localize('search.regexBuilder.copyExpression', "Copy expression"), () => this.copyExpression());
		this.createButton(actions, nls.localize('search.regexBuilder.copyExport', "Copy export"), () => this.copyExport(), true);

		this.statusNode = dom.append(this.container, dom.$('.search-regex-builder-status'));
		this.statusNode.setAttribute('role', 'status');
		this.statusNode.setAttribute('aria-live', 'polite');
		this.statusNode.textContent = nls.localize('search.regexBuilder.enterPattern', "Enter a pattern to preview matches.");
		this.matchesNode = dom.append(this.container, dom.$('ol.search-regex-builder-matches'));
		this.matchesNode.setAttribute('aria-label', nls.localize('search.regexBuilder.matchResults', "Regex preview matches"));

		this._register(dom.addDisposableListener(this.container, dom.EventType.KEY_DOWN, event => {
			if ((event as KeyboardEvent).key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				this.hide(true);
			}
		}));
	}

	setSearchState(state: ISearchRegexBuilderState): void {
		if (this.isApplyingInsertion) {
			return;
		}
		this.state = state;
		if (this.patternInput.value !== state.query) {
			this.patternInput.value = state.query;
		}
		this.regexCheckbox.checked = state.isRegex;
		this.wholeWordsCheckbox.checked = state.isWholeWords;
		const ignoreCase = this.flagCheckboxes.get('i');
		if (ignoreCase) {
			ignoreCase.checked = !state.isCaseSensitive;
		}
		this.scheduleEvaluation();
	}

	toggle(): void {
		if (this.container.hidden) {
			this.show();
		} else {
			this.hide(true);
		}
	}

	get visible(): boolean {
		return !this.container.hidden;
	}

	focus(): void {
		this.patternInput.focus();
	}

	show(): void {
		if (!this.container.hidden) {
			return;
		}
		this.container.hidden = false;
		this.container.setAttribute('aria-hidden', 'false');
		this.toggleControl.checked = true;
		const closeLabel = nls.localize('search.regexBuilder.close', "Close regex builder");
		this.toggleControl.setTitle(closeLabel);
		this._onDidChangeHeight.fire();
		this.patternInput.focus();
		this.scheduleEvaluation();
	}

	hide(returnFocus = false): void {
		if (this.container.hidden) {
			return;
		}
		this.container.hidden = true;
		this.container.setAttribute('aria-hidden', 'true');
		this.toggleControl.checked = false;
		const openLabel = nls.localize('search.regexBuilder.open', "Open regex builder");
		this.toggleControl.setTitle(openLabel);
		this.evaluationSequence++;
		this.evaluationDelayer.cancel();
		this.activeWorker.clear();
		this._onDidChangeHeight.fire();
		if (returnFocus) {
			this.callbacks.focusSearchInput();
		}
	}

	private createCheckbox(parent: HTMLElement, id: string, labelText: string, onChange: () => void): HTMLInputElement {
		const wrapper = dom.append(parent, dom.$('.search-regex-builder-checkbox'));
		const input = dom.append(wrapper, dom.$('input')) as HTMLInputElement;
		input.id = id;
		input.type = 'checkbox';
		const label = dom.append(wrapper, dom.$('label'));
		label.setAttribute('for', id);
		label.textContent = labelText;
		this._register(dom.addDisposableListener(input, dom.EventType.CHANGE, onChange));
		return input;
	}

	private createButton(parent: HTMLElement, label: string, callback: () => void | Promise<void>, secondary = true): Button {
		const button = this._register(new Button(parent, { ...defaultButtonStyles, secondary, title: label }));
		button.label = label;
		this._register(button.onDidClick(callback));
		return button;
	}

	private getFlagLabel(flag: RegexBuilderFlag): string {
		switch (flag) {
			case 'd': return nls.localize('search.regexBuilder.flag.d', "d — capture indices (export only)");
			case 'g': return nls.localize('search.regexBuilder.flag.g', "g — all matches");
			case 'i': return nls.localize('search.regexBuilder.flag.i', "i — ignore case (synchronized with Search)");
			case 'm': return nls.localize('search.regexBuilder.flag.m', "m — multiline anchors (preview only)");
			case 's': return nls.localize('search.regexBuilder.flag.s', "s — dot matches newlines (preview only)");
			case 'u': return nls.localize('search.regexBuilder.flag.u', "u — Unicode (preview only)");
			case 'v': return nls.localize('search.regexBuilder.flag.v', "v — Unicode sets (preview only)");
			case 'y': return nls.localize('search.regexBuilder.flag.y', "y — sticky match (preview only)");
		}
	}

	private insertLiteral(): void {
		if (!this.literalInput.value) {
			this.literalInput.focus();
			return;
		}
		const escaped = escapeRegexLiteral(this.literalInput.value);
		const insertion = insertRegexFragment(this.patternInput.value, this.patternInput.selectionStart, this.patternInput.selectionEnd, escaped);
		this.applyInsertion(insertion.value, insertion.selectionStart, insertion.selectionStart);
		this.literalInput.value = '';
	}

	private insertFragment(fragment: IGuidedFragment): void {
		const insertion = insertRegexFragment(
			this.patternInput.value,
			this.patternInput.selectionStart,
			this.patternInput.selectionEnd,
			fragment.prefix,
			fragment.suffix,
			fragment.fallback
		);
		this.applyInsertion(insertion.value, insertion.selectionStart, insertion.selectionEnd);
	}

	private applyInsertion(value: string, selectionStart: number, selectionEnd: number): void {
		this.patternInput.value = value;
		this.patternInput.focus();
		this.patternInput.setSelectionRange(selectionStart, selectionEnd);
		this.regexCheckbox.checked = true;
		this.state = { ...this.state, query: value, isRegex: true };
		this.isApplyingInsertion = true;
		try {
			this.callbacks.onQueryChange(value);
			this.updateSearchOptions();
		} finally {
			this.isApplyingInsertion = false;
		}
		this.scheduleEvaluation();
	}

	private updateSearchOptions(): void {
		const ignoreCase = this.flagCheckboxes.get('i')?.checked ?? !this.state.isCaseSensitive;
		const options = {
			isRegex: this.regexCheckbox.checked,
			isCaseSensitive: !ignoreCase,
			isWholeWords: this.wholeWordsCheckbox.checked,
		};
		this.state = { ...this.state, ...options };
		this.callbacks.onSearchOptionsChange(options);
		this.scheduleEvaluation();
	}

	private onFlagChanged(flag: RegexBuilderFlag): void {
		if (flag === 'u' && this.flagCheckboxes.get('u')?.checked) {
			const unicodeSets = this.flagCheckboxes.get('v');
			if (unicodeSets) {
				unicodeSets.checked = false;
			}
		} else if (flag === 'v' && this.flagCheckboxes.get('v')?.checked) {
			const unicode = this.flagCheckboxes.get('u');
			if (unicode) {
				unicode.checked = false;
			}
		}
		if (flag === 'i') {
			this.updateSearchOptions();
		} else {
			this.scheduleEvaluation();
		}
	}

	private getFlags(): string {
		return getSupportedRegexBuilderFlags().filter(flag => this.flagCheckboxes.get(flag)?.checked).join('');
	}

	private scheduleEvaluation(): void {
		if (this.container.hidden) {
			return;
		}
		this.evaluationDelayer.trigger(() => this.evaluate());
	}

	private async evaluate(): Promise<void> {
		const sequence = ++this.evaluationSequence;
		const rawPattern = this.patternInput.value;
		if (!rawPattern) {
			this.activeWorker.clear();
			dom.clearNode(this.matchesNode);
			this.statusNode.classList.remove('error');
			this.statusNode.textContent = nls.localize('search.regexBuilder.enterPattern', "Enter a pattern to preview matches.");
			this._onDidChangeHeight.fire();
			return;
		}

		this.statusNode.classList.remove('error');
		this.statusNode.textContent = nls.localize('search.regexBuilder.evaluating', "Evaluating locally…");

		const worker = this.webWorkerService.createWorkerClient<IRegexBuilderWorker>(new WebWorkerDescriptor({
			esmModuleLocation: FileAccess.asBrowserUri('vs/workbench/contrib/search/common/regexBuilderMain.js'),
			label: 'RegexBuilderPreviewWorker',
		}));
		this.activeWorker.value = worker;
		let timeoutHandle: number | undefined;
		const targetWindow = dom.getWindow(this.container);
		const timeoutResult = new Promise<undefined>(resolve => {
			timeoutHandle = targetWindow.setTimeout(() => resolve(undefined), REGEX_BUILDER_EVALUATION_TIMEOUT);
		});

		try {
			const pattern = this.regexCheckbox.checked ? rawPattern : escapeRegexLiteral(rawPattern);
			const result = await Promise.race([
				worker.proxy.$evaluate({ pattern, flags: this.getFlags(), sample: this.sampleInput.value }),
				timeoutResult,
			]);
			if (sequence !== this.evaluationSequence) {
				return;
			}
			if (!result) {
				this.renderEvaluationError(nls.localize('search.regexBuilder.timeout', "Preview stopped after {0} ms. Simplify the pattern or sample text.", REGEX_BUILDER_EVALUATION_TIMEOUT));
				return;
			}
			this.renderResult(result);
		} catch (error) {
			if (sequence === this.evaluationSequence) {
				this.renderEvaluationError(nls.localize('search.regexBuilder.workerError', "Could not evaluate the preview: {0}", error instanceof Error ? error.message : String(error)));
			}
		} finally {
			if (timeoutHandle !== undefined) {
				targetWindow.clearTimeout(timeoutHandle);
			}
			if (this.activeWorker.value === worker) {
				this.activeWorker.clear();
			} else {
				worker.dispose();
			}
		}
	}

	private renderResult(result: IRegexBuilderResult): void {
		dom.clearNode(this.matchesNode);
		if (result.errorCode) {
			let message: string;
			switch (result.errorCode) {
				case 'patternTooLong':
					message = nls.localize('search.regexBuilder.patternTooLong', "Pattern exceeds the {0}-character local preview limit.", REGEX_BUILDER_MAX_PATTERN_LENGTH);
					break;
				case 'sampleTooLong':
					message = nls.localize('search.regexBuilder.sampleTooLong', "Sample text exceeds the {0}-character local preview limit.", REGEX_BUILDER_MAX_SAMPLE_LENGTH);
					break;
				case 'invalidFlags':
					message = nls.localize('search.regexBuilder.invalidFlags', "The JavaScript flags are invalid: {0}", result.errorMessage ?? '');
					break;
				case 'invalidPattern':
					message = nls.localize('search.regexBuilder.invalidPattern', "Invalid JavaScript regular expression: {0}", result.errorMessage ?? '');
					break;
			}
			this.renderEvaluationError(message);
			return;
		}

		this.statusNode.classList.remove('error');
		const matchStatus = result.truncated
			? nls.localize('search.regexBuilder.matchesTruncated', "Showing the first {0} matches.", result.matches.length)
			: result.matches.length === 1
				? nls.localize('search.regexBuilder.oneMatch', "1 match.")
				: nls.localize('search.regexBuilder.matches', "{0} matches.", result.matches.length);
		const availableCaptureRecords = result.matches.reduce((count, match) => count + match.captures.length + Object.keys(match.namedCaptures).length, 0);
		const captureRecordsTruncated = result.captureRecordsTruncated || availableCaptureRecords > REGEX_BUILDER_MAX_CAPTURE_RECORDS;
		this.statusNode.textContent = captureRecordsTruncated
			? nls.localize('search.regexBuilder.captureRecordsTruncated', "{0} Capture details are limited to the first {1} records.", matchStatus, REGEX_BUILDER_MAX_CAPTURE_RECORDS)
			: matchStatus;

		let remainingCaptureRecords = REGEX_BUILDER_MAX_CAPTURE_RECORDS;
		for (const match of result.matches) {
			remainingCaptureRecords -= this.renderMatch(match, remainingCaptureRecords);
		}
		this._onDidChangeHeight.fire();
	}

	private renderEvaluationError(message: string): void {
		dom.clearNode(this.matchesNode);
		this.statusNode.classList.add('error');
		this.statusNode.textContent = message;
		this._onDidChangeHeight.fire();
	}

	private renderMatch(match: IRegexBuilderMatch, captureRecordLimit: number): number {
		const item = dom.append(this.matchesNode, dom.$('li'));
		const value = this.getDisplayValue(match.value);
		const summary = dom.append(item, dom.$('code'));
		summary.textContent = nls.localize('search.regexBuilder.matchSummary', "Index {0}, length {1}: {2}", match.index, match.length, value);

		let renderedCaptureRecords = 0;
		if (captureRecordLimit > 0 && (match.captures.length || Object.keys(match.namedCaptures).length)) {
			const captures = dom.append(item, dom.$('ul.search-regex-builder-captures'));
			for (const capture of match.captures) {
				if (renderedCaptureRecords >= captureRecordLimit) {
					break;
				}
				const captureItem = dom.append(captures, dom.$('li'));
				captureItem.textContent = nls.localize('search.regexBuilder.captureSummary', "Group {0}: {1}", capture.index, capture.value === undefined ? nls.localize('search.regexBuilder.unmatched', "unmatched") : this.getDisplayValue(capture.value));
				renderedCaptureRecords++;
			}
			for (const [name, capture] of Object.entries(match.namedCaptures)) {
				if (renderedCaptureRecords >= captureRecordLimit) {
					break;
				}
				const captureItem = dom.append(captures, dom.$('li'));
				captureItem.textContent = nls.localize('search.regexBuilder.namedCaptureSummary', "Group {0}: {1}", name, capture === undefined ? nls.localize('search.regexBuilder.unmatched', "unmatched") : this.getDisplayValue(capture));
				renderedCaptureRecords++;
			}
		}

		return renderedCaptureRecords;
	}

	private getDisplayValue(value: string): string {
		return value.length > REGEX_BUILDER_DISPLAY_VALUE_LIMIT
			? `${value.slice(0, REGEX_BUILDER_DISPLAY_VALUE_LIMIT)}…`
			: value;
	}

	private async copyExpression(): Promise<void> {
		try {
			const expression = createRegexBuilderExpression(this.patternInput.value, this.getFlags(), this.regexCheckbox.checked);
			await this.clipboardService.writeText(expression);
			this.notificationService.info(nls.localize('search.regexBuilder.expressionCopied', "Regular expression copied."));
		} catch (error) {
			this.notificationService.error(nls.localize('search.regexBuilder.expressionCopyFailed', "Cannot copy an invalid regular expression: {0}", error instanceof Error ? error.message : String(error)));
		}
	}

	private async copyExport(): Promise<void> {
		await this.clipboardService.writeText(JSON.stringify({
			engine: 'JavaScript RegExp (ECMAScript)',
			pattern: this.patternInput.value,
			flags: this.getFlags(),
			search: {
				isRegex: this.regexCheckbox.checked,
				isCaseSensitive: !(this.flagCheckboxes.get('i')?.checked ?? false),
				isWholeWords: this.wholeWordsCheckbox.checked,
			},
		}, undefined, 2));
		this.notificationService.info(nls.localize('search.regexBuilder.exportCopied', "Regex builder export copied without sample text."));
	}
}
