import generatedValidator from "../generated/package-v2-validator.js";

type SchemaError = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
};

type PackageValidator = ((value: unknown) => boolean) & {
  errors?: SchemaError[] | null;
};

const validatePackage = generatedValidator as PackageValidator;
const sourceVariants = ["catalog", "host", "path", "git"] as const;

export function assertPackageSchema(value: unknown, label: string): void {
  if (validatePackage(value)) return;

  const errors = validatePackage.errors ?? [];
  const error = selectError(errors, value);
  if (!error) throw new Error(`${label} does not match agulater/package/v2`);
  throw new Error(formatError(error, value, label));
}

function selectError(errors: SchemaError[], value: unknown): SchemaError | undefined {
  const sourceTypeError = errors.find((error) => {
    if (error.keyword !== "const" || !error.instancePath.endsWith("/type")) return false;
    const actual = valueAt(value, error.instancePath);
    return typeof actual === "string" && !sourceVariants.includes(actual as (typeof sourceVariants)[number]);
  });
  if (sourceTypeError) return sourceTypeError;

  const knownSourceType = errors
    .filter((error) => error.instancePath.endsWith("/source/type"))
    .map((error) => parentPointer(error.instancePath))
    .map((pointer) => valueAt(value, pointer))
    .find((candidate) => isRecord(candidate) && sourceVariants.includes(candidate.type as (typeof sourceVariants)[number]));
  if (knownSourceType && isRecord(knownSourceType)) {
    const branch = sourceVariants.indexOf(knownSourceType.type as (typeof sourceVariants)[number]);
    const branchErrors = errors.filter((error) =>
      (error.schemaPath.startsWith(`#/oneOf/${branch}/`)
        || error.schemaPath.startsWith(`#/$defs/source/oneOf/${branch}/`))
      && error.keyword !== "const"
    );
    const branchError = branchErrors.find((error) => error.keyword === "additionalProperties")
      ?? branchErrors.find((error) => error.keyword === "required")
      ?? branchErrors[0];
    if (branchError) return branchError;
  }

  return errors.find((error) => error.keyword !== "oneOf" && error.keyword !== "const")
    ?? errors.find((error) => error.keyword !== "oneOf")
    ?? errors[0];
}

function formatError(error: SchemaError, value: unknown, label: string): string {
  const path = displayPath(label, error.instancePath);
  switch (error.keyword) {
    case "additionalProperties":
      return `${path} has unknown field ${String(error.params.additionalProperty)}`;
    case "required":
      return `${path} needs ${String(error.params.missingProperty)}`;
    case "type":
      return `${path} must be ${typeDescription(String(error.params.type))}`;
    case "minLength":
      return `${path} must be a non-empty string`;
    case "minItems":
      return `${path} must not be empty`;
    case "uniqueItems":
      return `${path} must contain unique items`;
    case "pattern":
      return patternMessage(path, error.schemaPath);
    case "enum":
      return `${path} must be ${(error.params.allowedValues as unknown[]).join(", ")}`;
    case "const": {
      const actual = valueAt(value, error.instancePath);
      if (error.instancePath.endsWith("/type") && !sourceVariants.includes(actual as (typeof sourceVariants)[number])) {
        return `${path} must be catalog, host, path, or git`;
      }
      return `${path} must be ${String(error.params.allowedValue)}`;
    }
    default:
      return `${path} ${error.message ?? "does not match agulater/package/v2"}`;
  }
}

function patternMessage(path: string, schemaPath: string): string {
  if (schemaPath.includes("/$defs/id/")) return `${path} must be a lowercase package id`;
  if (schemaPath.includes("/$defs/version/")) return `${path} must be a SemVer version`;
  if (schemaPath.includes("/$defs/range/")) return `${path} must be an exact, ^, ~, >=, or * SemVer range`;
  if (schemaPath.includes("/$defs/path/") || schemaPath.includes("/$defs/source_path/")) {
    return `${path} must be a clean package-relative path using /`;
  }
  return `${path} has an invalid value`;
}

function typeDescription(type: string): string {
  if (type === "object") return "a JSON object";
  if (type === "array") return "an array";
  if (type === "string") return "a string";
  return `a ${type}`;
}

function displayPath(label: string, pointer: string): string {
  return pointerSegments(pointer).reduce((path, segment) => {
    return /^\d+$/.test(segment) ? `${path}[${segment}]` : `${path}.${segment}`;
  }, label);
}

function valueAt(value: unknown, pointer: string): unknown {
  return pointerSegments(pointer).reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) return current[Number(segment)];
    return isRecord(current) ? current[segment] : undefined;
  }, value);
}

function pointerSegments(pointer: string): string[] {
  if (!pointer) return [];
  return pointer.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function parentPointer(pointer: string): string {
  const slash = pointer.lastIndexOf("/");
  return slash <= 0 ? "" : pointer.slice(0, slash);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
