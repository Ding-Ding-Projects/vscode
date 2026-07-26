/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWebWorkerService } from '../../../../../platform/webWorker/browser/webWorkerService.js';
import { ISearchRegexBuilderState, SearchRegexBuilder } from '../../browser/regexBuilder.js';

suite('SearchRegexBuilder', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('guided insertion keeps regex enabled during synchronous Search state synchronization', () => {
		const parent = document.createElement('div');
		let searchState: ISearchRegexBuilderState = { query: 'start', isRegex: false, isCaseSensitive: false, isWholeWords: false };
		const holder: { builder?: SearchRegexBuilder } = {};

		const builder = store.add(new SearchRegexBuilder(
			parent,
			{
				onQueryChange: query => {
					searchState = { ...searchState, query };
					holder.builder?.setSearchState(searchState);
				},
				onSearchOptionsChange: options => {
					searchState = { ...searchState, ...options };
					holder.builder?.setSearchState(searchState);
				},
				onSubmitSearch: () => { },
				focusSearchInput: () => { },
			},
			{} as IClipboardService,
			{} as INotificationService,
			{} as IWebWorkerService,
		));
		holder.builder = builder;
		builder.setSearchState(searchState);

		const characterClassButton = parent.querySelector<HTMLElement>('.search-regex-builder-fragments .monaco-button');
		assert.ok(characterClassButton);
		characterClassButton.click();

		const regexCheckbox = parent.querySelector<HTMLInputElement>('input[id^="search-regex-builder-regex-"]');
		assert.ok(regexCheckbox);
		assert.strictEqual(searchState.isRegex, true);
		assert.strictEqual(regexCheckbox.checked, true);
		assert.strictEqual(searchState.query, 'start[abc]');

		const patternInput = parent.querySelector<HTMLTextAreaElement>('.search-regex-builder-pattern');
		const literalInput = parent.querySelector<HTMLInputElement>('.search-regex-builder-literal');
		const addLiteralButton = parent.querySelector<HTMLElement>('.search-regex-builder-add-literal');
		assert.ok(patternInput);
		assert.ok(literalInput);
		assert.ok(addLiteralButton);
		patternInput.setSelectionRange(0, 0);
		literalInput.value = '.';
		addLiteralButton.click();

		assert.strictEqual(searchState.query, '\\.start[abc]');
		assert.strictEqual(patternInput.selectionStart, 2);
		assert.strictEqual(patternInput.selectionEnd, 2);
	});
});
