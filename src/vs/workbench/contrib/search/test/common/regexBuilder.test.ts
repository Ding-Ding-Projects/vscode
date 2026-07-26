/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	createRegexBuilderExpression,
	escapeRegexLiteral,
	getSupportedRegexBuilderFlags,
	insertRegexFragment,
	REGEX_BUILDER_MAX_CAPTURE_RECORDS,
	REGEX_BUILDER_MAX_MATCHES,
	REGEX_BUILDER_MAX_PATTERN_LENGTH,
	REGEX_BUILDER_MAX_SAMPLE_LENGTH,
	RegexBuilderWorker,
} from '../../common/regexBuilder.js';

suite('RegexBuilder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('escapes literal text for the JavaScript RegExp constructor', () => {
		assert.strictEqual(escapeRegexLiteral('a.b/c [d] (e)+?'), 'a\\.b\\/c \\[d\\] \\(e\\)\\+\\?');
	});

	test('copies a plain-text dot with literal semantics', () => {
		assert.strictEqual(createRegexBuilderExpression('.', 'gi', false), '/\\./gi');
	});

	test('copies a regex-mode dot with regex semantics', () => {
		assert.strictEqual(createRegexBuilderExpression('.', 'giu', true), '/./giu');
	});

	test('copies raw and already escaped slashes without double escaping', () => {
		assert.strictEqual(createRegexBuilderExpression('folder/file', 'g', true), '/folder\\/file/g');
		assert.strictEqual(createRegexBuilderExpression('folder\\/file', 'g', true), '/folder\\/file/g');
	});

	test('copies supported flags in canonical JavaScript order', () => {
		assert.strictEqual(createRegexBuilderExpression('word', 'mig', true), '/word/gim');
	});

	test('inserts a guided fragment around the selected text', () => {
		assert.deepStrictEqual(insertRegexFragment('beforeWORDafter', 6, 10, '(?:', ')+'), {
			value: 'before(?:WORD)+after',
			selectionStart: 9,
			selectionEnd: 13,
		});
	});

	test('uses a guided fallback and clamps invalid selections', () => {
		assert.deepStrictEqual(insertRegexFragment('a', 100, -1, '[', ']', 'abc'), {
			value: 'a[abc]',
			selectionStart: 2,
			selectionEnd: 5,
		});
	});

	test('returns live matches, numbered captures, and named captures', () => {
		const result = new RegexBuilderWorker().$evaluate({
			pattern: '(?<word>\\w+)-(\\d+)',
			flags: 'g',
			sample: 'abc-12 def-34',
		});

		assert.deepStrictEqual(result, {
			matches: [
				{ index: 0, length: 6, value: 'abc-12', captures: [{ index: 1, value: 'abc' }, { index: 2, value: '12' }], namedCaptures: { word: 'abc' } },
				{ index: 7, length: 6, value: 'def-34', captures: [{ index: 1, value: 'def' }, { index: 2, value: '34' }], namedCaptures: { word: 'def' } },
			],
			truncated: false,
			captureRecordsTruncated: false,
		});
	});

	test('reports invalid syntax without evaluating sample text', () => {
		const result = new RegexBuilderWorker().$evaluate({ pattern: '(', flags: 'gu', sample: 'anything' });
		assert.strictEqual(result.errorCode, 'invalidPattern');
		assert.deepStrictEqual(result.matches, []);
	});

	test('reports invalid and duplicate flags', () => {
		const worker = new RegexBuilderWorker();
		assert.strictEqual(worker.$evaluate({ pattern: 'a', flags: 'z', sample: 'a' }).errorCode, 'invalidFlags');
		assert.strictEqual(worker.$evaluate({ pattern: 'a', flags: 'gg', sample: 'a' }).errorCode, 'invalidFlags');
	});

	test('handles Unicode and multiline flags', () => {
		const result = new RegexBuilderWorker().$evaluate({ pattern: '^😀.$', flags: 'gmu', sample: '😀a\n😀b' });
		assert.deepStrictEqual(result.matches.map(match => ({ index: match.index, value: match.value })), [
			{ index: 0, value: '😀a' },
			{ index: 4, value: '😀b' },
		]);
	});

	test('advances safely after zero-width matches', () => {
		const result = new RegexBuilderWorker().$evaluate({ pattern: '(?=a)', flags: 'g', sample: 'aaa' });
		assert.deepStrictEqual(result.matches.map(match => match.index), [0, 1, 2]);
	});

	test('advances by a full astral code point in Unicode modes', () => {
		const supportedFlags = getSupportedRegexBuilderFlags();
		const unicodeModes = ['u', 'v'].filter(flag => supportedFlags.includes(flag as 'u' | 'v'));
		const worker = new RegexBuilderWorker();
		assert.deepStrictEqual(unicodeModes.map(flag => ({
			flag,
			indices: worker.$evaluate({ pattern: '(?=.)', flags: `g${flag}`, sample: '😀' }).matches.map(match => match.index),
		})), unicodeModes.map(flag => ({ flag, indices: [0] })));
	});

	test('distinguishes literal and regular expression previews', () => {
		const worker = new RegexBuilderWorker();
		const regexResult = worker.$evaluate({ pattern: '.', flags: 'g', sample: 'a.b' });
		const literalResult = worker.$evaluate({ pattern: escapeRegexLiteral('.'), flags: 'g', sample: 'a.b' });
		assert.deepStrictEqual({ regex: regexResult.matches.length, literal: literalResult.matches.map(match => match.index) }, { regex: 3, literal: [1] });
	});

	test('bounds pattern and sample input before expression execution', () => {
		const worker = new RegexBuilderWorker();
		assert.strictEqual(worker.$evaluate({ pattern: 'a'.repeat(REGEX_BUILDER_MAX_PATTERN_LENGTH + 1), flags: 'g', sample: '' }).errorCode, 'patternTooLong');
		assert.strictEqual(worker.$evaluate({ pattern: '(a+)+$', flags: 'g', sample: 'a'.repeat(REGEX_BUILDER_MAX_SAMPLE_LENGTH + 1) }).errorCode, 'sampleTooLong');
	});

	test('caps the number of live matches', () => {
		const worker = new RegexBuilderWorker();
		const result = worker.$evaluate({ pattern: '.', flags: 'g', sample: 'a'.repeat(REGEX_BUILDER_MAX_MATCHES + 10) });
		assert.deepStrictEqual({ count: result.matches.length, truncated: result.truncated }, { count: REGEX_BUILDER_MAX_MATCHES, truncated: true });
		assert.strictEqual(worker.$evaluate({ pattern: '.', flags: 'g', sample: 'a'.repeat(REGEX_BUILDER_MAX_MATCHES) }).truncated, false);
	});

	test('caps aggregate numbered and named capture records', () => {
		const result = new RegexBuilderWorker().$evaluate({
			pattern: '(?<named>)()',
			flags: 'g',
			sample: 'a'.repeat(REGEX_BUILDER_MAX_CAPTURE_RECORDS),
		});
		const captureRecordCount = result.matches.reduce((count, match) => count + match.captures.length + Object.keys(match.namedCaptures).length, 0);

		assert.strictEqual(captureRecordCount, REGEX_BUILDER_MAX_CAPTURE_RECORDS);
		assert.strictEqual(result.captureRecordsTruncated, true);
	});

	test('returns an empty result when there is no match', () => {
		assert.deepStrictEqual(new RegexBuilderWorker().$evaluate({ pattern: 'z+', flags: 'gu', sample: 'abc' }), { matches: [], truncated: false, captureRecordsTruncated: false });
	});
});
