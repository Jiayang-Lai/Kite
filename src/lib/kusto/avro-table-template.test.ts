import { describe, expect, it } from 'vitest';

import {
	MAX_AVRO_TABLE_TEMPLATE_BYTES,
	buildAvroTableSchema,
	parseAvroTableTemplate,
	readAvroTableTemplate
} from './avro-table-template';
import type { KustoTable } from '$lib/types/kusto-schema';

describe('Avro table templates', () => {
	it('maps an Avro record and its logical and complex fields to a Kusto table draft', async () => {
		await expect(
			parseAvroTableTemplate(`{
				"type": "record",
				"name": "Events",
				"doc": "Event rows",
				"kite.folder": "Operations",
				"fields": [
					{ "name": "Timestamp", "type": { "type": "long", "logicalType": "timestamp-millis" } },
					{ "name": "TraceId", "type": { "type": "string", "logicalType": "uuid" } },
					{ "name": "Message", "type": ["null", "string"], "default": null },
					{ "name": "Payload", "type": { "type": "map", "values": "string" } }
				]
			}`)
		).resolves.toEqual({
			tableName: 'Events',
			docstring: 'Event rows',
			folder: 'Operations',
			columns: [
				{ name: 'Timestamp', type: 'datetime' },
				{ name: 'TraceId', type: 'guid' },
				{ name: 'Message', type: 'string' },
				{ name: 'Payload', type: 'dynamic' }
			]
		});
	});

	it('maps mixed unions and named complex types to dynamic', async () => {
		const template = await parseAvroTableTemplate(`{
			"type": "record",
			"name": "Metrics",
			"fields": [
				{
					"name": "Value",
					"type": ["int", "string"]
				},
				{
					"name": "Dimensions",
					"type": {
						"type": "record",
						"name": "DimensionsRecord",
						"fields": [{ "name": "Host", "type": "string" }]
					}
				}
			]
		}`);

		expect(template.columns).toEqual([
			{ name: 'Value', type: 'dynamic' },
			{ name: 'Dimensions', type: 'dynamic' }
		]);
	});

	it('rejects invalid JSON, non-record schemas, and invalid Avro definitions', async () => {
		await expect(parseAvroTableTemplate('{')).rejects.toThrow('not valid JSON');
		await expect(parseAvroTableTemplate('"string"')).rejects.toThrow(
			'document must be a JSON object'
		);
		await expect(
			parseAvroTableTemplate(`{
			"type": "record",
			"name": "Events",
			"fields": [{ "name": "Value", "type": "not-a-real-avro-type" }]
		}`)
		).rejects.toThrow('invalid name');
	});

	it('rejects files that exceed the import size limit', async () => {
		const file = new File(['x'.repeat(MAX_AVRO_TABLE_TEMPLATE_BYTES + 1)], 'too-large.avsc', {
			type: 'application/json'
		});

		await expect(readAvroTableTemplate(file)).rejects.toThrow('larger than');
	});

	it('exports a table as a re-importable Avro record without losing Kusto names', async () => {
		const table = {
			name: 'Event Logs',
			docstring: 'Events with arbitrary metadata.',
			columns: [
				{ name: 'Recorded At', type: 'datetime' },
				{ name: 'Trace Id', type: 'guid' },
				{ name: 'Elapsed', type: 'timespan' },
				{ name: 'Payload', type: 'dynamic' }
			]
		} as KustoTable;

		const schema = buildAvroTableSchema(table);

		expect(schema).toMatchObject({
			type: 'record',
			name: 'Event_Logs',
			'kite.tableName': 'Event Logs',
			fields: [
				{
					name: 'Recorded_At',
					'kite.columnName': 'Recorded At',
					type: { type: 'long', logicalType: 'timestamp-millis' }
				},
				{ name: 'Trace_Id', 'kite.columnName': 'Trace Id', type: { logicalType: 'uuid' } },
				{ name: 'Elapsed', type: { logicalType: 'duration', size: 12 } },
				{ name: 'Payload', type: { type: 'map', values: 'string' } }
			]
		});

		await expect(parseAvroTableTemplate(JSON.stringify(schema))).resolves.toMatchObject({
			tableName: 'Event Logs',
			columns: [
				{ name: 'Recorded At', type: 'datetime' },
				{ name: 'Trace Id', type: 'guid' },
				{ name: 'Elapsed', type: 'timespan' },
				{ name: 'Payload', type: 'dynamic' }
			]
		});
	});
});
