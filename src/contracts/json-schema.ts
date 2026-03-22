export class ContractValidationError extends Error {}

function matchesType(expected: unknown, value: unknown): boolean {
  if (Array.isArray(expected)) return expected.some((item) => matchesType(item, value));
  if (expected === "null") return value === null;
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "string") return typeof value === "string";
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "boolean") return typeof value === "boolean";
  return true;
}

function describeType(expected: unknown): string {
  return Array.isArray(expected) ? expected.join(" | ") : String(expected);
}

function validateNode(schema: Record<string, unknown>, value: unknown, path: string): void {
  const expectedType = schema.type;
  if (expectedType !== undefined && !matchesType(expectedType, value)) {
    throw new ContractValidationError(`${path}: expected ${describeType(expectedType)}, got ${typeof value}`);
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    throw new ContractValidationError(`${path}: value is not in allowed enum`);
  }

  if (value == null) return;

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    throw new ContractValidationError(`${path}: must be >= ${schema.minimum}`);
  }

  if (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object") && typeof value === "object" && !Array.isArray(value))) {
    validateObject(schema, value, path);
    return;
  }
  if (schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array") && Array.isArray(value))) {
    validateArray(schema, value, path);
  }
}

function validateObject(schema: Record<string, unknown>, value: unknown, path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractValidationError(`${path}: expected object`);
  }
  const record = value as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && !(key in record)) {
      throw new ContractValidationError(`${path}: missing required property ${key}`);
    }
  }
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  if (schema.additionalProperties === false) {
    const unexpected = Object.keys(record).filter((key) => !(key in properties));
    if (unexpected.length > 0) {
      throw new ContractValidationError(`${path}: unexpected properties ${unexpected.join(", ")}`);
    }
  }
  for (const [key, child] of Object.entries(properties)) {
    if (key in record) validateNode(child, record[key], `${path}.${key}`);
  }
}

function validateArray(schema: Record<string, unknown>, value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new ContractValidationError(`${path}: expected array`);
  const itemSchema = schema.items;
  if (!itemSchema || typeof itemSchema !== "object" || Array.isArray(itemSchema)) return;
  value.forEach((item, index) => validateNode(itemSchema as Record<string, unknown>, item, `${path}[${index}]`));
}

export function validateContractPayload(schema: Record<string, unknown>, value: unknown): void {
  validateNode(schema, value, "$");
}
