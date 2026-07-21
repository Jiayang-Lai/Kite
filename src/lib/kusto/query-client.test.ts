import { describe, expect, it } from 'vitest';

import {
	getKustoErrorMessage,
	isManagementCommand,
	isReadOnlyManagementCommand
} from './query-client';

describe('getKustoErrorMessage', () => {
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

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400 BadRequest

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

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400

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

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400 Bad Request

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

		expect(getKustoErrorMessage(error)).toBe(`HTTP 400

SEM0100: Unknown column X`);
	});
});

describe('management command classification', () => {
	it('accepts commands that start with a period after whitespace', () => {
		expect(isManagementCommand('  .show tables')).toBe(true);
		expect(isManagementCommand('StormEvents | take 10')).toBe(false);
	});

	it('only treats inspection commands as read-only', () => {
		expect(isReadOnlyManagementCommand('.show tables')).toBe(true);
		expect(isReadOnlyManagementCommand(' .explain .show tables')).toBe(true);
		expect(isReadOnlyManagementCommand('.create table Metrics (Timestamp: datetime)')).toBe(false);
	});
});
