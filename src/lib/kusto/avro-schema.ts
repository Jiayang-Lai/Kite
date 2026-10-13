/**
 * Avro schema validation without code generation.
 *
 * Kite previously validated templates with avsc's `Type.forSchema`, which compiles record types
 * with `new Function` and therefore needs a Content Security Policy with 'unsafe-eval'. This
 * module accepts and rejects the same schemas as avsc 5.7 without logical types: logical types
 * are ignored, matching the Avro specification's fallback to the underlying type. One deliberate
 * difference follows the specification: a record with a full name ignores its `namespace`
 * attribute when resolving the names inside it.
 */

const PRIMITIVE_TYPES = new Set([
	'null',
	'boolean',
	'int',
	'long',
	'float',
	'double',
	'bytes',
	'string'
]);
const FIELD_ORDERS = new Set(['ascending', 'descending', 'ignore']);
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// avsc's safe long range, which is slightly narrower than Number.MAX_SAFE_INTEGER.
const MAX_SAFE_LONG = 9007199254740990;

type AvroField = { name: string; type: AvroType; hasDefault: boolean };

type AvroType =
	| { kind: 'primitive'; name: string }
	| { kind: 'record'; typeName: 'record' | 'error'; fullName?: string; fields?: AvroField[] }
	| { kind: 'enum'; fullName?: string; symbols: Set<string> }
	| { kind: 'fixed'; fullName?: string; size: number }
	| { kind: 'array'; items: AvroType }
	| { kind: 'map'; values: AvroType }
	| { kind: 'union'; branches: AvroType[] };

type Scope = { namespace?: string; registry: Map<string, AvroType> };

const typeName = (type: AvroType) =>
	type.kind === 'primitive' ? type.name : type.kind === 'record' ? type.typeName : type.kind;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Qualifies a short name with a namespace and validates every name segment. */
function qualify(name: string, namespace: unknown) {
	let qualified = name;
	if (name.includes('.')) qualified = name.replace(/^\./, '');
	else if (namespace) qualified = `${namespace}.${name}`;
	for (const part of qualified.split('.')) {
		if (!NAME_PATTERN.test(part)) throw new Error(`invalid name: ${JSON.stringify(qualified)}`);
	}
	return qualified;
}

/** Primitive names stay in the global namespace even when written with a namespace. */
function maybeQualify(name: string, namespace: unknown) {
	const unqualified = name.slice(name.lastIndexOf('.') + 1);
	return PRIMITIVE_TYPES.has(unqualified) ? unqualified : qualify(name, namespace);
}

function registerNamedType(
	schema: Record<string, unknown>,
	type: AvroType & { fullName?: string },
	scope: Scope
) {
	const namespace = schema.namespace === undefined ? scope.namespace : schema.namespace;
	if (schema.name !== undefined) {
		if (typeof schema.name !== 'string') throw new Error('invalid name: a name must be a string.');
		const fullName = maybeQualify(schema.name, namespace);
		if (PRIMITIVE_TYPES.has(fullName)) {
			throw new Error(`cannot rename primitive type: ${JSON.stringify(fullName)}`);
		}
		if (scope.registry.has(fullName)) throw new Error(`duplicate type name: ${fullName}`);
		scope.registry.set(fullName, type);
		type.fullName = fullName;
	}
	if (schema.aliases) {
		if (!Array.isArray(schema.aliases)) throw new Error('invalid aliases: expected an array.');
		for (const alias of schema.aliases) {
			if (typeof alias !== 'string') throw new Error('invalid alias: an alias must be a string.');
			maybeQualify(alias, namespace);
		}
	}
}

function parseType(schema: unknown, scope: Scope): AvroType {
	if (schema === null) throw new Error('invalid type: null (did you mean "null"?)');

	if (typeof schema === 'string') {
		const name = maybeQualify(schema, scope.namespace);
		if (PRIMITIVE_TYPES.has(name)) return { kind: 'primitive', name };
		const type = scope.registry.get(name);
		if (!type) throw new Error(`undefined type name: ${name}`);
		return type;
	}

	if (Array.isArray(schema)) return parseUnion(schema, scope);

	// In object form, `type` must name a built-in type; named-type references are not allowed here.
	const kind = isObject(schema) ? schema.type : undefined;
	if (!isObject(schema) || typeof kind !== 'string') {
		throw new Error(`unknown type: ${JSON.stringify(kind)}`);
	}
	if (PRIMITIVE_TYPES.has(kind)) return { kind: 'primitive', name: kind };

	switch (kind) {
		case 'record':
		case 'error':
			return parseRecord(schema, kind, scope);
		case 'enum':
			return parseEnum(schema, scope);
		case 'fixed': {
			const type: AvroType = { kind: 'fixed', size: 0 };
			registerNamedType(schema, type, scope);
			const size = schema.size;
			if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > 2 ** 31 - 1) {
				throw new Error(`invalid fixed size: ${JSON.stringify(size)}`);
			}
			type.size = size;
			return type;
		}
		case 'array':
			if (schema.items === undefined) throw new Error('missing array items.');
			return { kind: 'array', items: parseType(schema.items, scope) };
		case 'map':
			if (schema.values === undefined) throw new Error('missing map values.');
			return { kind: 'map', values: parseType(schema.values, scope) };
		default:
			throw new Error(`unknown type: ${JSON.stringify(kind)}`);
	}
}

function parseUnion(schema: unknown[], scope: Scope): AvroType {
	if (!schema.length) throw new Error('empty union');
	const branches = schema.map((branch) => parseType(branch, scope));
	const branchNames = new Set<string>();
	for (const branch of branches) {
		if (branch.kind === 'union') throw new Error('unions cannot be directly nested');
		const name = ('fullName' in branch && branch.fullName) || typeName(branch);
		if (branchNames.has(name)) {
			throw new Error(`duplicate union branch name: ${JSON.stringify(name)}`);
		}
		branchNames.add(name);
	}
	return { kind: 'union', branches };
}

function parseEnum(schema: Record<string, unknown>, scope: Scope): AvroType {
	const type: AvroType = { kind: 'enum', symbols: new Set() };
	registerNamedType(schema, type, scope);
	if (!Array.isArray(schema.symbols) || !schema.symbols.length) {
		throw new Error(`invalid enum symbols: ${JSON.stringify(schema.symbols)}`);
	}
	for (const symbol of schema.symbols) {
		if (typeof symbol !== 'string' || !NAME_PATTERN.test(symbol)) {
			throw new Error(`invalid enum symbol: ${JSON.stringify(symbol)}`);
		}
		if (type.symbols.has(symbol)) throw new Error(`duplicate enum symbol: ${symbol}`);
		type.symbols.add(symbol);
	}
	if (schema.default !== undefined && !isValidDefault(type, schema.default)) {
		throw new Error(`invalid enum default: ${JSON.stringify(schema.default)}`);
	}
	return type;
}

function parseRecord(
	schema: Record<string, unknown>,
	recordTypeName: 'record' | 'error',
	parentScope: Scope
): AvroType {
	// A record's namespace applies to the types nested in its fields. A full name wins over the
	// `namespace` attribute, which the Avro specification ignores in that case (avsc does not).
	let namespace = parentScope.namespace;
	if (typeof schema.name === 'string' && schema.name.includes('.')) {
		namespace = schema.name.slice(0, schema.name.lastIndexOf('.'));
	} else if (schema.namespace !== undefined) namespace = schema.namespace as string;
	const scope: Scope = { namespace, registry: parentScope.registry };

	const type: AvroType & { kind: 'record' } = { kind: 'record', typeName: recordTypeName };
	registerNamedType(schema, type, scope);
	if (!Array.isArray(schema.fields)) {
		throw new Error(`non-array record fields: ${JSON.stringify(schema.fields)}`);
	}

	const fieldNames = new Set<string>();
	const fields: AvroField[] = [];
	for (const field of schema.fields) {
		if (!isObject(field)) throw new Error(`invalid record field: ${JSON.stringify(field)}`);
		if (fieldNames.has(field.name as string)) {
			throw new Error(`duplicate field name: ${JSON.stringify(field.name)}`);
		}
		fieldNames.add(field.name as string);
	}
	for (const field of schema.fields as Record<string, unknown>[]) {
		if (typeof field.name !== 'string' || !NAME_PATTERN.test(field.name)) {
			throw new Error(`invalid field name: ${String(field.name)}`);
		}
		if (field.type === undefined) throw new Error(`missing type for field ${field.name}.`);
		const fieldType = parseType(field.type, scope);
		if (field.order !== undefined && !FIELD_ORDERS.has(field.order as string)) {
			throw new Error(`invalid order: ${JSON.stringify(field.order)}`);
		}
		// Defaults are checked as each field is defined, so a default cannot rely on fields of the
		// enclosing record that are still being defined (avsc rejects those too).
		if (field.default !== undefined && !isValidDefault(fieldType, field.default)) {
			throw new Error(
				`incompatible field default ${JSON.stringify(field.default)} for ${field.name}` +
					(fieldType.kind === 'union' ? ", union defaults must match the first branch's type" : '')
			);
		}
		fields.push({ name: field.name, type: fieldType, hasDefault: field.default !== undefined });
	}
	type.fields = fields;
	return type;
}

/** Checks a JSON default value; union defaults must match the union's first branch. */
function isValidDefault(type: AvroType, value: unknown): boolean {
	switch (type.kind) {
		case 'primitive':
			switch (type.name) {
				case 'null':
					return value === null;
				case 'boolean':
					return typeof value === 'boolean';
				case 'int':
					return typeof value === 'number' && value === (value | 0);
				case 'long':
					return (
						typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_LONG
					);
				case 'float':
				case 'double':
					return typeof value === 'number';
				case 'string':
				case 'bytes':
					// Avro's JSON encoding represents bytes as a string of code points.
					return typeof value === 'string';
			}
			return false;
		case 'fixed':
			return typeof value === 'string' && value.length === type.size;
		case 'enum':
			return typeof value === 'string' && type.symbols.has(value);
		case 'array':
			return Array.isArray(value) && value.every((item) => isValidDefault(type.items, item));
		case 'map':
			return (
				isObject(value) &&
				!Array.isArray(value) &&
				Object.values(value).every((item) => isValidDefault(type.values, item))
			);
		case 'union':
			return isValidDefault(type.branches[0], value);
		case 'record':
			if (!type.fields) return false;
			if (!type.fields.length) return true;
			if (value === null || value === undefined) return false;
			return type.fields.every((field) => {
				const fieldValue = (value as Record<string, unknown>)[field.name];
				return fieldValue === undefined ? field.hasDefault : isValidDefault(field.type, fieldValue);
			});
	}
}

/** Throws when `schema` is not a valid Avro schema. */
export function validateAvroSchema(schema: unknown): void {
	parseType(schema, { registry: new Map() });
}
