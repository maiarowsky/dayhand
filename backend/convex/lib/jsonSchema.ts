// Derives MCP tool input schemas (JSON Schema) from the same Convex
// validators the domain functions enforce, so the two cannot drift apart.
import type { GenericValidator, PropertyValidators } from "convex/values";

type Schema = Record<string, unknown>;

export function toJsonSchema(validator: GenericValidator): Schema {
  switch (validator.kind) {
    case "string":
      return { type: "string" };
    case "float64":
      return { type: "number" };
    case "int64":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "any":
      return {};
    case "id":
      return { type: "string", description: `Id of a ${validator.tableName} record` };
    case "literal":
      return { const: validator.value };
    case "array":
      return { type: "array", items: toJsonSchema(validator.element) };
    case "object":
      return objectSchema(validator.fields);
    case "union": {
      const members = validator.members as GenericValidator[];
      if (members.every((m) => m.kind === "literal")) {
        return { type: "string", enum: members.map((m) => (m.kind === "literal" ? m.value : null)) };
      }
      return { anyOf: members.map(toJsonSchema) };
    }
    default:
      throw new Error(`No JSON Schema mapping for validator kind "${validator.kind}"`);
  }
}

export function objectSchema(fields: PropertyValidators, docs: Record<string, string> = {}): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const schema = toJsonSchema(field);
    properties[name] = docs[name] ? { ...schema, description: docs[name] } : schema;
    if (field.isOptional === "required") required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
