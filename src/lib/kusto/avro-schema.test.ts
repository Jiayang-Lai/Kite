import { describe, expect, it } from 'vitest';

import { validateAvroSchema } from './avro-schema';

const record = (fields: unknown[], extra: Record<string, unknown> = {}) => ({
	type: 'record',
	name: 'Events',
	fields,
	...extra
});

describe('validateAvroSchema', () => {
	it.each([
		[
			'primitive references and object forms',
			record([
				{ name: 'a', type: 'int' },
				{ name: 'b', type: { type: 'string' } }
			])
		],
		[
			'logical types on their underlying type',
			record([{ name: 'at', type: { type: 'long', logicalType: 'timestamp-millis' } }])
		],
		[
			'nested named types and later references',
			record([
				{ name: 'kind', type: { type: 'enum', name: 'Kind', symbols: ['A', 'B'], default: 'A' } },
				{ name: 'other', type: 'Kind' },
				{ name: 'id', type: { type: 'fixed', name: 'Id', size: 16 } }
			])
		],
		['recursive records', record([{ name: 'next', type: ['null', 'Events'], default: null }])],
		[
			'namespace-qualified references',
			record(
				[
					{ name: 'a', type: { type: 'fixed', name: 'Hash', size: 4 } },
					{ name: 'b', type: 'com.example.Hash' }
				],
				{ namespace: 'com.example' }
			)
		],
		[
			'arrays and maps with defaults',
			record([
				{ name: 'tags', type: { type: 'array', items: 'string' }, default: ['a'] },
				{ name: 'props', type: { type: 'map', values: 'long' }, default: { a: 1 } }
			])
		],
		[
			'union defaults that match the first branch',
			record([{ name: 'v', type: ['string', 'null'], default: 'x' }])
		],
		[
			'record defaults that use nested field defaults',
			record([
				{
					name: 'inner',
					type: record([{ name: 'n', type: 'int', default: 1 }], { name: 'Inner' }),
					default: {}
				}
			])
		],
		[
			'aliases, dotted names, and error records',
			{
				type: 'error',
				name: 'com.example.Failure',
				aliases: ['Problem', '.other.Problem'],
				fields: [
					{ name: 'kind', type: { type: 'enum', name: 'Kind', symbols: ['A'] }, default: 'A' },
					{ name: 'again', type: 'com.example.Kind' }
				]
			}
		],
		[
			'defaults for every primitive type',
			record([
				{ name: 'n', type: 'null', default: null },
				{ name: 'b', type: 'boolean', default: true },
				{ name: 'l', type: 'long', default: 2 ** 40 },
				{ name: 'f', type: 'float', default: 1.5 },
				{ name: 'd', type: 'double', default: 2.5 },
				{ name: 'by', type: 'bytes', default: '\u00ff' },
				{ name: 's', type: 'string', default: '', order: 'descending' }
			])
		],
		[
			'record defaults with explicit field values',
			record([
				{
					name: 'inner',
					type: record([{ name: 'n', type: 'int' }], { name: 'Inner' }),
					default: { n: 1 }
				},
				{ name: 'empty', type: record([], { name: 'Empty' }), default: null }
			])
		],
		[
			'full names that override the namespace attribute for nested references',
			record([
				{
					name: 'inner',
					type: {
						type: 'record',
						name: 'actual.Inner',
						namespace: 'ignored',
						fields: [{ name: 'next', type: ['null', 'Inner'] }]
					}
				}
			])
		]
	])('accepts %s', (_name, schema) => {
		expect(() => validateAvroSchema(schema)).not.toThrow();
	});

	it.each([
		['unknown type names', record([{ name: 'a', type: 'not-a-real-avro-type' }]), 'invalid name'],
		['undefined references', record([{ name: 'a', type: 'Missing' }]), 'undefined type name'],
		[
			'named references in object form',
			record([{ name: 'a', type: { type: 'Events' } }]),
			'unknown type'
		],
		[
			'renamed primitives',
			record([{ name: 'a', type: { type: 'fixed', name: 'com.int', size: 1 } }]),
			'cannot rename primitive'
		],
		[
			'duplicate type names',
			record([{ name: 'a', type: { type: 'enum', name: 'Events', symbols: ['A'] } }]),
			'duplicate type name'
		],
		[
			'duplicate field names',
			record([
				{ name: 'a', type: 'int' },
				{ name: 'a', type: 'long' }
			]),
			'duplicate field name'
		],
		['invalid field names', record([{ name: '1a', type: 'int' }]), 'invalid field name'],
		['missing field types', record([{ name: 'a' }]), 'missing type'],
		[
			'invalid field order',
			record([{ name: 'a', type: 'int', order: 'sideways' }]),
			'invalid order'
		],
		['empty unions', record([{ name: 'a', type: [] }]), 'empty union'],
		['nested unions', record([{ name: 'a', type: ['null', ['int']] }]), 'directly nested'],
		[
			'duplicate union branches',
			record([{ name: 'a', type: ['int', { type: 'int' }] }]),
			'duplicate union branch'
		],
		[
			'invalid enum symbols',
			record([{ name: 'a', type: { type: 'enum', name: 'E', symbols: ['A', 'A'] } }]),
			'duplicate enum symbol'
		],
		[
			'invalid fixed sizes',
			record([{ name: 'a', type: { type: 'fixed', name: 'F', size: -1 } }]),
			'invalid fixed size'
		],
		[
			'arrays without items',
			record([{ name: 'a', type: { type: 'array' } }]),
			'missing array items'
		],
		[
			'defaults of the wrong type',
			record([{ name: 'a', type: 'int', default: 'x' }]),
			'incompatible field default'
		],
		[
			'union defaults for a later branch',
			record([{ name: 'a', type: ['null', 'string'], default: 'x' }]),
			'first branch'
		],
		[
			'out-of-range int defaults',
			record([{ name: 'a', type: 'int', default: 2 ** 31 }]),
			'incompatible field default'
		],
		[
			'fixed defaults of the wrong length',
			record([{ name: 'a', type: { type: 'fixed', name: 'F', size: 2 }, default: 'a' }]),
			'incompatible field default'
		],
		['null schemas', record([{ name: 'a', type: null }]), 'did you mean "null"'],
		[
			'invalid namespaces',
			record([{ name: 'a', type: 'int' }], { namespace: 'bad-ns' }),
			'invalid name'
		],
		['non-object schemas', 5, 'unknown type'],
		['unknown object types', record([{ name: 'a', type: { type: 'decimal' } }]), 'unknown type'],
		['non-string names', { type: 'fixed', name: 1, size: 1 }, 'a name must be a string'],
		['non-array aliases', record([], { aliases: 'Other' }), 'invalid aliases'],
		['non-string aliases', record([], { aliases: [1] }), 'an alias must be a string'],
		['invalid aliases', record([], { aliases: ['bad-alias'] }), 'invalid name'],
		['non-array record fields', record([], { fields: {} }), 'non-array record fields'],
		['non-object record fields', record(['a']), 'invalid record field'],
		['empty enum symbols', { type: 'enum', name: 'E', symbols: [] }, 'invalid enum symbols'],
		['non-name enum symbols', { type: 'enum', name: 'E', symbols: ['1'] }, 'invalid enum symbol'],
		[
			'enum defaults outside the symbols',
			{ type: 'enum', name: 'E', symbols: ['A'], default: 'B' },
			'invalid enum default'
		],
		['maps without values', { type: 'map' }, 'missing map values'],
		[
			'out-of-range long defaults',
			record([{ name: 'a', type: 'long', default: 2 ** 60 }]),
			'incompatible field default'
		],
		[
			'boolean defaults of the wrong type',
			record([{ name: 'a', type: 'boolean', default: 0 }]),
			'incompatible field default'
		],
		[
			'map defaults given as arrays',
			record([{ name: 'a', type: { type: 'map', values: 'int' }, default: [] }]),
			'incompatible field default'
		],
		[
			'array defaults with invalid items',
			record([{ name: 'a', type: { type: 'array', items: 'int' }, default: ['x'] }]),
			'incompatible field default'
		],
		[
			'null defaults for records with fields',
			record([
				{ name: 'a', type: record([{ name: 'n', type: 'int' }], { name: 'Inner' }), default: null }
			]),
			'incompatible field default'
		],
		[
			'record defaults missing a required field',
			record([
				{ name: 'a', type: record([{ name: 'n', type: 'int' }], { name: 'Inner' }), default: {} }
			]),
			'incompatible field default'
		],
		[
			'record defaults that refer to the enclosing record',
			record([{ name: 'self', type: 'Events', default: {} }]),
			'incompatible field default'
		]
	])('rejects %s', (_name, schema, message) => {
		expect(() => validateAvroSchema(schema)).toThrow(message);
	});
});
