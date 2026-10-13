import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './error-message';

describe('getErrorMessage', () => {
	it('preserves the complete text response and HTTP status', () => {
		const error = Object.assign(new Error('Request failed with status code 400'), {
			response: {
				status: 400,
				statusText: 'BadRequest',
				data: `General_BadRequest: Request is invalid and cannot be executed.
Error details:
ClientRequestId='Kite.Query;123', ActivityId='activity-123', Timestamp='2026-07-14T23:05:33Z'.`,
				headers: { 'x-ms-activity-id': 'activity-123' }
			}
		});

		expect(getErrorMessage(error)).toBe(`HTTP 400 BadRequest

General_BadRequest: Request is invalid and cannot be executed.
Error details:
ClientRequestId='Kite.Query;123', ActivityId='activity-123', Timestamp='2026-07-14T23:05:33Z'.`);
	});

	it('formats structured Kusto errors and activity IDs', () => {
		const error = Object.assign(new Error('Bad request'), {
			response: {
				status: 400,
				data: { error: { code: 'SemanticError', message: 'Unknown column X.' } },
				headers: { 'x-ms-activity-id': 'activity-456' }
			}
		});

		expect(getErrorMessage(error)).toBe(`HTTP 400

SemanticError: Unknown column X.

Activity ID: activity-456`);
	});

	it('prefers actionable details from a nested Kusto exception', () => {
		const error = Object.assign(new Error('Request failed with status code 400'), {
			response: {
				status: 400,
				statusText: 'Bad Request',
				data: {
					error: {
						code: 'General_BadRequest',
						message: 'Request is invalid and cannot be executed.',
						'@message':
							'Request is invalid and cannot be processed: Syntax error: SYN0002: Missing expression [line:position=2:7]',
						'@database': 'NetDefaultDB',
						'@context': {
							clientRequestId: 'Kite.Query;123',
							activityId: 'activity-123'
						},
						innererror: {
							code: 'SYN0002',
							message: 'Missing expression',
							'@message': 'Syntax error: SYN0002: Missing expression [line:position=2:7]',
							'@line': '2',
							'@pos': '7',
							'@errorCode': 'SYN0002',
							'@errorMessage': 'Missing expression'
						}
					}
				},
				headers: { 'x-ms-activity-id': 'activity-123' }
			}
		});

		expect(getErrorMessage(error)).toBe(`HTTP 400 Bad Request

SYN0002: Missing expression
Syntax error: SYN0002: Missing expression [line:position=2:7]
Line 2, column 7
Database: NetDefaultDB
Client request ID: Kite.Query;123
Activity ID: activity-123`);
	});

	it('parses a JSON Kusto error returned as text', () => {
		const error = Object.assign(new Error('Bad request'), {
			response: {
				status: 400,
				data: JSON.stringify({
					error: {
						code: 'General_BadRequest',
						message: 'Request is invalid.',
						innererror: { code: 'SEM0100', message: 'Unknown column X' }
					}
				})
			}
		});

		expect(getErrorMessage(error)).toBe(`HTTP 400

SEM0100: Unknown column X`);
	});

	it.each([
		['malformed JSON text', '{not json', '{not json'],
		['string error payloads', { error: 'Throttled.' }, 'Throttled.'],
		['message payloads', { message: 'Gateway timeout.' }, 'Gateway timeout.'],
		['other JSON payloads', '{"detail":1}', '{\n  "detail": 1\n}'],
		['non-object payloads', 42, 'Fallback message']
	])('formats %s', (_name, data, expected) => {
		const error = Object.assign(new Error('Fallback message'), { response: { data } });

		expect(getErrorMessage(error)).toBe(expected);
	});

	it('falls back when response data cannot be serialized', () => {
		const data: Record<string, unknown> = {};
		data.self = data;
		const error = Object.assign(new Error('Fallback message'), { response: { data } });

		expect(getErrorMessage(error)).toBe('Fallback message');
	});

	it('reads activity IDs from header accessors and skips ones already in the message', () => {
		const headers = { get: (name: string) => (name === 'x-ms-activity-id' ? 'activity-1' : null) };
		const withAccessor = Object.assign(new Error('Failed'), {
			response: { status: 503, statusText: 'Unavailable', headers }
		});
		const alreadyMentioned = Object.assign(new Error('Failed'), {
			response: { data: 'Failed in activity-2', headers: { 'X-Ms-Activity-Id': 'activity-2' } }
		});

		expect(getErrorMessage(withAccessor)).toBe(
			'HTTP 503 Unavailable\n\nFailed\n\nActivity ID: activity-1'
		);
		expect(getErrorMessage(alreadyMentioned)).toBe('Failed in activity-2');
	});
});
