import {
  getLottieDimensions,
  LOTTIE_GENERATION_CONFIG,
  type LottieAspectRatioKey,
} from "../config.js";

export const LOTTIE_VALIDATION_VERSION = "lottie-v1";

export interface LottieValidationResult {
  decision: "pass" | "fail";
  errors: string[];
  warnings: string[];
  version: typeof LOTTIE_VALIDATION_VERSION;
}

export interface LottieValidationInput {
  aspectRatio: LottieAspectRatioKey;
  durationSeconds: number;
  fps: number;
  lottie: unknown;
}

export interface ParsedLottieModelResponse {
  lottie: unknown;
  rawLottieJson: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
}

function looksLikeLottieRoot(value: unknown): boolean {
  return (
    isRecord(value)
    && typeof value.v === "string"
    && typeof value.fr === "number"
    && typeof value.ip === "number"
    && typeof value.op === "number"
    && typeof value.w === "number"
    && typeof value.h === "number"
    && Array.isArray(value.layers)
  );
}

export function parseLottieModelResponse(rawResponse: string): ParsedLottieModelResponse {
  const parsed = JSON.parse(stripJsonFence(rawResponse)) as unknown;

  if (isRecord(parsed) && typeof parsed.lottie_json === "string") {
    const lottie = JSON.parse(parsed.lottie_json) as unknown;
    return {
      lottie,
      rawLottieJson: JSON.stringify(lottie),
    };
  }

  if (isRecord(parsed) && looksLikeLottieRoot(parsed.lottie)) {
    return {
      lottie: parsed.lottie,
      rawLottieJson: JSON.stringify(parsed.lottie),
    };
  }

  if (looksLikeLottieRoot(parsed)) {
    return {
      lottie: parsed,
      rawLottieJson: JSON.stringify(parsed),
    };
  }

  throw new Error("Gemini response did not contain a parseable Lottie document");
}

function fail(errors: string[], warnings: string[] = []): LottieValidationResult {
  return {
    decision: errors.length === 0 ? "pass" : "fail",
    errors,
    warnings,
    version: LOTTIE_VALIDATION_VERSION,
  };
}

function pushRootFieldError(
  root: JsonRecord,
  key: string,
  expected: string,
  errors: string[],
): void {
  if (!(key in root)) {
    errors.push(`Missing root field "${key}"`);
    return;
  }
  if (typeof root[key] !== expected) {
    errors.push(`Root field "${key}" must be ${expected}`);
  }
}

function collectSidFallbackErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSidFallbackErrors(item, `${path}[${index}]`, errors));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.sid === "string" && !("k" in value)) {
    errors.push(`${path} uses sid "${value.sid}" without a lottie-web k fallback`);
  }

  for (const [key, nested] of Object.entries(value)) {
    collectSidFallbackErrors(nested, `${path}.${key}`, errors);
  }
}

function collectExpressionErrors(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectExpressionErrors(item, `${path}[${index}]`, errors));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (
      typeof nested === "string"
      && (key === "x" || key === "exp" || key === "expression")
    ) {
      errors.push(`${nestedPath} uses an expression string, which is not supported in v1`);
      continue;
    }
    collectExpressionErrors(nested, nestedPath, errors);
  }
}

function validateLayers(root: JsonRecord, errors: string[]): void {
  const layers = root.layers;
  if (!Array.isArray(layers)) {
    errors.push('Root field "layers" must be an array');
    return;
  }

  if (layers.length === 0) {
    errors.push("Lottie must contain at least one layer");
  }
  if (layers.length > LOTTIE_GENERATION_CONFIG.maxLayers) {
    errors.push(`Lottie has ${layers.length} layers; max is ${LOTTIE_GENERATION_CONFIG.maxLayers}`);
  }

  layers.forEach((layer, index) => {
    if (!isRecord(layer)) {
      errors.push(`Layer ${index} must be an object`);
      return;
    }

    if (layer.ty !== 3 && layer.ty !== 4) {
      errors.push(`Layer ${index} uses unsupported ty ${String(layer.ty)}; v1 allows shape and null layers only`);
    }

    if (layer.ty === 4 && !Array.isArray(layer.shapes)) {
      errors.push(`Shape layer ${index} must include a shapes array`);
    }

    if ("ef" in layer) {
      errors.push(`Layer ${index} uses effects, which are not supported in v1`);
    }
    if ("tt" in layer || "td" in layer) {
      errors.push(`Layer ${index} uses track mattes, which are not supported in v1`);
    }
  });
}

const VALID_SHAPE_TYPES = new Set(["gr", "el", "rc", "sr", "sh", "fl", "st", "tr", "tm", "rd", "rp", "mm", "pb"]);

function validateGroupItems(
  items: unknown[],
  pathPrefix: string,
  errors: string[],
): void {
  const lastItem = items[items.length - 1];
  if (!isRecord(lastItem) || lastItem.ty !== "tr") {
    errors.push(
      `${pathPrefix} must end with a transform (ty: "tr") as the last item in its it array`,
    );
  }

  items.forEach((item, index) => {
    if (!isRecord(item)) return;

    const ty = item.ty;
    if (typeof ty === "string" && !VALID_SHAPE_TYPES.has(ty)) {
      errors.push(`${pathPrefix} item ${index} uses unsupported type "${ty}"`);
    }

    if (ty === "gr" && Array.isArray(item.it)) {
      validateGroupItems(item.it as unknown[], `${pathPrefix} nested group ${index}`, errors);
    }
  });
}

function validateShapesArray(
  shapes: unknown[],
  pathPrefix: string,
  errors: string[],
): void {
  shapes.forEach((shape, shapeIndex) => {
    if (!isRecord(shape)) {
      errors.push(`${pathPrefix} shape ${shapeIndex} must be an object`);
      return;
    }

    const ty = shape.ty;
    if (typeof ty === "string" && !VALID_SHAPE_TYPES.has(ty)) {
      errors.push(`${pathPrefix} shape ${shapeIndex} uses unsupported type "${ty}"`);
    }

    if (ty !== "gr") {
      errors.push(
        `${pathPrefix} shape ${shapeIndex} is not wrapped in a group (ty: "gr"). ` +
        'Flat shapes in a layer render blank. Wrap all geometry, fills, and strokes inside a group.',
      );
    }

    if (ty === "gr" && Array.isArray(shape.it)) {
      validateGroupItems(shape.it as unknown[], `${pathPrefix} group ${shapeIndex}`, errors);
    }
  });
}

function validateGroupWrapping(root: JsonRecord, errors: string[]): void {
  const layers = root.layers;
  if (!Array.isArray(layers)) return;

  layers.forEach((layer, index) => {
    if (!isRecord(layer) || layer.ty !== 4 || !Array.isArray(layer.shapes)) return;

    validateShapesArray(layer.shapes as unknown[], `Layer ${index}`, errors);
  });
}

export function validateLottieDocument(input: LottieValidationInput): LottieValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = input.lottie;

  if (!isRecord(root)) {
    return fail(["Lottie document must be a JSON object"]);
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(root), "utf8");
  if (serializedBytes > LOTTIE_GENERATION_CONFIG.maxJsonBytes) {
    errors.push(`Lottie JSON is ${serializedBytes} bytes; max is ${LOTTIE_GENERATION_CONFIG.maxJsonBytes}`);
  }

  pushRootFieldError(root, "v", "string", errors);
  pushRootFieldError(root, "fr", "number", errors);
  pushRootFieldError(root, "ip", "number", errors);
  pushRootFieldError(root, "op", "number", errors);
  pushRootFieldError(root, "w", "number", errors);
  pushRootFieldError(root, "h", "number", errors);
  pushRootFieldError(root, "nm", "string", errors);

  const dimensions = getLottieDimensions(input.aspectRatio);
  if (root.w !== dimensions.width || root.h !== dimensions.height) {
    errors.push(`Canvas must be ${dimensions.width}x${dimensions.height} for ${input.aspectRatio}`);
  }
  if (root.fr !== input.fps) {
    errors.push(`Frame rate must be ${input.fps}`);
  }
  if (root.ip !== 0) {
    errors.push("Start frame ip must be 0");
  }
  if (root.op !== input.durationSeconds * input.fps) {
    errors.push(`End frame op must be ${input.durationSeconds * input.fps}`);
  }

  if (!Array.isArray(root.assets)) {
    errors.push('Root field "assets" must be an array');
  } else if (root.assets.length > 0) {
    errors.push("V1 Lottie output must be vector-only and cannot contain assets");
  }

  if ("bg" in root) {
    errors.push("Transparent output must not set a root bg color");
  }
  if ("fonts" in root || "chars" in root) {
    errors.push("Text/font tables are not supported in v1");
  }

  validateLayers(root, errors);
  validateGroupWrapping(root, errors);
  collectSidFallbackErrors(root, "$", errors);
  collectExpressionErrors(root, "$", errors);

  return fail(errors, warnings);
}

export function normalizeLottieJsonForStorage(lottie: unknown): string {
  return `${JSON.stringify(lottie)}\n`;
}
