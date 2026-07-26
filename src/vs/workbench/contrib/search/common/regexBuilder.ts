/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWebWorkerServer, IWebWorkerServerRequestHandler } from '../../../../base/common/worker/webWorker.js';

export const REGEX_BUILDER_MAX_PATTERN_LENGTH = 8 * 1024;
export const REGEX_BUILDER_MAX_SAMPLE_LENGTH = 64 * 1024;
export const REGEX_BUILDER_MAX_MATCHES = 250;
export const REGEX_BUILDER_MAX_CAPTURE_RECORDS = 250;

export const REGEX_BUILDER_FLAGS = ['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'] as const;

export type RegexBuilderFlag = typeof REGEX_BUILDER_FLAGS[number];

export type RegexBuilderErrorCode = 'invalidFlags' | 'invalidPattern' | 'patternTooLong' | 'sampleTooLong';

export interface IRegexBuilderRequest {
	readonly pattern: string;
	readonly flags: string;
	readonly sample: string;
}

export interface IRegexBuilderCapture {
	readonly index: number;
	readonly value: string | undefined;
}

export interface IRegexBuilderMatch {
	readonly index: number;
	readonly length: number;
	readonly value: string;
	readonly captures: readonly IRegexBuilderCapture[];
	readonly namedCaptures: Readonly<Record<string, string | undefined>>;
}

export interface IRegexBuilderResult {
	readonly matches: readonly IRegexBuilderMatch[];
	readonly truncated: boolean;
	readonly captureRecordsTruncated: boolean;
	readonly errorCode?: RegexBuilderErrorCode;
	readonly errorMessage?: string;
}

export interface IRegexBuilderWorker extends IWebWorkerServerRequestHandler {
	$evaluate(request: IRegexBuilderRequest): IRegexBuilderResult;
}

export interface IRegexInsertion {
	readonly value: string;
	readonly selectionStart: number;
	readonly selectionEnd: number;
}

export function escapeRegexLiteral(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

export function createRegexBuilderExpression(pattern: string, flags: string, isRegex: boolean): string {
	const effectivePattern = isRegex ? pattern : escapeRegexLiteral(pattern);
	return new RegExp(effectivePattern, flags).toString();
}

export function insertRegexFragment(value: string, selectionStart: number, selectionEnd: number, prefix: string, suffix = '', fallback = ''): IRegexInsertion {
	const safeStart = Math.max(0, Math.min(selectionStart, value.length));
	const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
	const selection = value.slice(safeStart, safeEnd) || fallback;
	const replacement = `${prefix}${selection}${suffix}`;
	const insertedSelectionStart = safeStart + prefix.length;

	return {
		value: value.slice(0, safeStart) + replacement + value.slice(safeEnd),
		selectionStart: insertedSelectionStart,
		selectionEnd: insertedSelectionStart + selection.length,
	};
}

export function getSupportedRegexBuilderFlags(): readonly RegexBuilderFlag[] {
	return REGEX_BUILDER_FLAGS.filter(flag => {
		try {
			new RegExp('', flag);
			return true;
		} catch {
			return false;
		}
	});
}

function validateFlags(flags: string): string | undefined {
	const seen = new Set<string>();
	for (const flag of flags) {
		if (!(REGEX_BUILDER_FLAGS as readonly string[]).includes(flag) || seen.has(flag)) {
			return flag;
		}
		seen.add(flag);
	}

	return undefined;
}

function advancePastZeroWidthMatch(expression: RegExp, sample: string): void {
	if (expression.lastIndex >= sample.length) {
		expression.lastIndex++;
		return;
	}

	const currentCodePoint = sample.codePointAt(expression.lastIndex);
	const unicodeSets = (expression as RegExp & { readonly unicodeSets?: boolean }).unicodeSets === true;
	const usesUnicodeCodePoints = expression.unicode || unicodeSets;
	expression.lastIndex += usesUnicodeCodePoints && currentCodePoint !== undefined && currentCodePoint > 0xFFFF ? 2 : 1;
}

export class RegexBuilderWorker implements IRegexBuilderWorker {
	_requestHandlerBrand: void = undefined;

	$evaluate(request: IRegexBuilderRequest): IRegexBuilderResult {
		if (request.pattern.length > REGEX_BUILDER_MAX_PATTERN_LENGTH) {
			return { matches: [], truncated: false, captureRecordsTruncated: false, errorCode: 'patternTooLong' };
		}
		if (request.sample.length > REGEX_BUILDER_MAX_SAMPLE_LENGTH) {
			return { matches: [], truncated: false, captureRecordsTruncated: false, errorCode: 'sampleTooLong' };
		}

		const invalidFlag = validateFlags(request.flags);
		if (invalidFlag !== undefined) {
			return { matches: [], truncated: false, captureRecordsTruncated: false, errorCode: 'invalidFlags', errorMessage: invalidFlag };
		}

		let expression: RegExp;
		try {
			expression = new RegExp(request.pattern, request.flags);
		} catch (error) {
			return {
				matches: [],
				truncated: false,
				captureRecordsTruncated: false,
				errorCode: 'invalidPattern',
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}

		const matches: IRegexBuilderMatch[] = [];
		let remainingCaptureRecords = REGEX_BUILDER_MAX_CAPTURE_RECORDS;
		let captureRecordsTruncated = false;
		let match: RegExpExecArray | null;
		do {
			match = expression.exec(request.sample);
			if (!match) {
				break;
			}

			const captureCount = match.length - 1;
			const capturesToKeep = Math.min(captureCount, remainingCaptureRecords);
			const captures: IRegexBuilderCapture[] = [];
			for (let index = 0; index < capturesToKeep; index++) {
				captures.push({ index: index + 1, value: match[index + 1] });
			}
			remainingCaptureRecords -= capturesToKeep;
			captureRecordsTruncated ||= capturesToKeep < captureCount;

			const namedCaptureEntries = Object.entries(match.groups ?? {});
			const namedCapturesToKeep = Math.min(namedCaptureEntries.length, remainingCaptureRecords);
			const namedCaptures = Object.fromEntries(namedCaptureEntries.slice(0, namedCapturesToKeep));
			remainingCaptureRecords -= namedCapturesToKeep;
			captureRecordsTruncated ||= namedCapturesToKeep < namedCaptureEntries.length;

			matches.push({
				index: match.index,
				length: match[0].length,
				value: match[0],
				captures,
				namedCaptures,
			});

			if (match[0].length === 0 && (expression.global || expression.sticky)) {
				advancePastZeroWidthMatch(expression, request.sample);
			}
		} while ((expression.global || expression.sticky) && matches.length < REGEX_BUILDER_MAX_MATCHES);

		const truncated = matches.length === REGEX_BUILDER_MAX_MATCHES && !!expression.exec(request.sample);
		return { matches, truncated, captureRecordsTruncated };
	}
}

export function create(_workerServer: IWebWorkerServer): IRegexBuilderWorker {
	return new RegexBuilderWorker();
}
