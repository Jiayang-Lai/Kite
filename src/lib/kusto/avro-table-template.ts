import type { KiteAvroTableTemplate } from '$lib/generated/kite-avro-table-template';
import type { KustoScalarType, NewTableColumn } from '$lib/kusto/table-management';
import type { KustoTable } from '$lib/types/kusto-schema';

export const MAX_AVRO_TABLE_TEMPLATE_BYTES = 256 * 1024;

export type ImportedAvroTableTemplate = {
	tableName: string;
	docstring: string;
	folder: string;
	columns: readonly NewTableColumn[];
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAvroName(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function invalidTemplate(message: string): never {
	throw new Error(`Invalid Avro table template: ${message}`);
}

function supportedRecord(value: unknown): KiteAvroTableTemplate {
	if (!isObject(value)) invalidTemplate('the document must be a JSON object.');
	if (value.type !== 'record') invalidTemplate('the top-level type must be “record”.');
	if (!isAvroName(value.name)) invalidTemplate('the record name must be a valid Avro name.');
	if (!Array.isArray(value.fields) || value.fields.length === 0) {
		invalidTemplate('the record must contain at least one field.');
	}
	if (value.doc != null && typeof value.doc !== 'string')
		invalidTemplate('“doc” must be a string.');
	if (value['kite.folder'] != null && typeof value['kite.folder'] !== 'string') {
		invalidTemplate('“kite.folder” must be a string.');
	}
	if (value['kite.tableName'] != null && typeof value['kite.tableName'] !== 'string') {
		invalidTemplate('“kite.tableName” must be a string.');
	}

	for (const [index, field] of value.fields.entries()) {
		if (!isObject(field) || !isAvroName(field.name) || !Object.hasOwn(field, 'type')) {
			invalidTemplate(`field ${index + 1} must have a valid Avro name and a type.`);
		}
		if (field['kite.columnName'] != null && typeof field['kite.columnName'] !== 'string') {
			invalidTemplate(`field ${index + 1} has an invalid “kite.columnName”.`);
		}
	}

	return value as KiteAvroTableTemplate;
}

function mapAvroType(schema: unknown): KustoScalarType {
	if (Array.isArray(schema)) {
		const nonNullTypes = schema.filter((branch) => branch !== 'null');
		if (nonNullTypes.length === 0) invalidTemplate('a field cannot have only the null type.');
		return nonNullTypes.length === 1 ? mapAvroType(nonNullTypes[0]) : 'dynamic';
	}

	if (typeof schema === 'string') {
		switch (schema) {
			case 'boolean':
				return 'bool';
			case 'int':
				return 'int';
			case 'long':
				return 'long';
			case 'float':
			case 'double':
				return 'real';
			case 'string':
				return 'string';
			case 'bytes':
				return 'dynamic';
			case 'null':
				invalidTemplate('a field cannot have only the null type.');
			default:
				// Named records and enums are represented as JSON in Kusto.
				return 'dynamic';
		}
	}

	if (!isObject(schema)) invalidTemplate('a field type must be an Avro type.');

	const logicalType = schema.logicalType;
	if (typeof logicalType === 'string') {
		switch (logicalType) {
			case 'date':
			case 'timestamp-millis':
			case 'timestamp-micros':
			case 'local-timestamp-millis':
			case 'local-timestamp-micros':
				return 'datetime';
			case 'time-millis':
			case 'time-micros':
			case 'duration':
				return 'timespan';
			case 'decimal':
				return 'decimal';
			case 'uuid':
				return 'guid';
		}
	}

	const type = schema.type;
	if (Array.isArray(type) || isObject(type)) return mapAvroType(type);
	if (typeof type !== 'string') invalidTemplate('a field type must declare “type”.');
	if (['record', 'array', 'map', 'enum', 'fixed'].includes(type)) return 'dynamic';
	return mapAvroType(type);
}

/** Parses one standard Avro record schema into Kite's table-creation input. */
export async function parseAvroTableTemplate(source: string): Promise<ImportedAvroTableTemplate> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new Error('The selected template is not valid JSON.');
	}

	const template = supportedRecord(parsed);
	try {
		// Avro's browser implementation is intentionally loaded only when a user imports a template.
		const { default: avsc } = await import('avsc');
		avsc.Type.forSchema(template as unknown as Parameters<typeof avsc.Type.forSchema>[0]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid Avro table template: ${message}`);
	}

	return {
		tableName: template['kite.tableName'] ?? template.name,
		docstring: template.doc ?? '',
		folder: template['kite.folder'] ?? '',
		columns: template.fields.map((field) => ({
			name: field['kite.columnName'] ?? field.name,
			type: mapAvroType(field.type)
		}))
	};
}

/** Reads a browser-selected Avro schema with a bounded size before parsing it. */
export async function readAvroTableTemplate(file: File): Promise<ImportedAvroTableTemplate> {
	if (file.size > MAX_AVRO_TABLE_TEMPLATE_BYTES) {
		throw new Error(
			`The selected template is larger than ${Math.floor(MAX_AVRO_TABLE_TEMPLATE_BYTES / 1024)} KB.`
		);
	}
	return parseAvroTableTemplate(await file.text());
}

function avroIdentifier(value: string, fallback: string) {
	const normalized = value.replaceAll(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
	return normalized || fallback;
}

function uniqueAvroIdentifier(value: string, used: Set<string>, fallback: string) {
	const base = avroIdentifier(value, fallback);
	let candidate = base;
	let suffix = 2;
	while (used.has(candidate)) candidate = `${base}_${suffix++}`;
	used.add(candidate);
	return candidate;
}

function avroTypeForKusto(type: string, fieldName: string, usedNamedTypes: Set<string>): unknown {
	switch (type) {
		case 'bool':
			return 'boolean';
		case 'datetime':
			return { type: 'long', logicalType: 'timestamp-millis' };
		case 'decimal':
			return { type: 'bytes', logicalType: 'decimal', precision: 38, scale: 18 };
		case 'guid':
			return { type: 'string', logicalType: 'uuid' };
		case 'int':
			return 'int';
		case 'long':
			return 'long';
		case 'real':
			return 'double';
		case 'string':
			return 'string';
		case 'timespan':
			return {
				type: 'fixed',
				name: uniqueAvroIdentifier(`${fieldName}_duration`, usedNamedTypes, 'duration'),
				size: 12,
				logicalType: 'duration'
			};
		case 'dynamic':
		default:
			return { type: 'map', values: 'string' };
	}
}

/** Builds a standard Avro record schema that can be re-imported into Kite without losing names. */
export function buildAvroTableSchema(table: KustoTable) {
	const usedFieldNames = new Set<string>();
	const usedNamedTypes = new Set<string>();
	const recordName = avroIdentifier(table.name, 'Table');
	usedNamedTypes.add(recordName);

	return {
		type: 'record',
		name: recordName,
		doc: table.docstring || undefined,
		'kite.tableName': table.name,
		fields: table.columns.map((column, index) => {
			const name = uniqueAvroIdentifier(column.name, usedFieldNames, `Column${index + 1}`);
			return {
				name,
				doc: column.docstring || undefined,
				'kite.columnName': column.name,
				type: avroTypeForKusto(column.type, name, usedNamedTypes)
			};
		})
	};
}
