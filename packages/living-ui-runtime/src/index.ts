export * from "./control.js";
export * from "./art.js";

export const LIVING_UI_PIPELINE = "celstate_living_ui_runtime_v1" as const;

export const LIVING_UI_ASSET_CLASSES = [
  "small_accent",
  "interactive_control",
  "button_overlay",
  "ambient_background",
  "loader_feedback",
] as const;

export type LivingUiAssetClass = (typeof LIVING_UI_ASSET_CLASSES)[number];

export type LivingMotionPath =
  | "generated_sprite_sheet"
  | "procedural_still"
  | "rigged_deformation";

export interface LivingUiRuntimeTarget {
  readonly component: string;
  readonly densityMax: number;
  readonly displayDpMax: number;
  readonly interaction: "loop" | "press-or-drag-state" | string;
  readonly rightSizeMaxScale: number;
  readonly rightSizePass: boolean;
  readonly targets: readonly string[];
}

export interface LivingUiSpriteSheet {
  readonly cellHeight: number;
  readonly cellWidth: number;
  readonly cols: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly height: number;
  readonly pngBytes?: number;
  readonly rows: number;
  readonly webpBytes?: number;
  readonly width: number;
}

export interface LivingUiManifest {
  readonly assetClass: LivingUiAssetClass | string;
  readonly assetLabel: string;
  readonly aspectRatio: string;
  readonly destination: string;
  readonly durationSeconds: number;
  readonly exports: {
    readonly apng?: string;
    readonly frames?: string;
    readonly mov?: string;
    readonly spriteSheetPng?: string;
    readonly spriteSheetWebp?: string;
    readonly webm?: string;
  };
  readonly fps: number;
  readonly frameCount: number;
  readonly generatedAt: string;
  readonly height: number;
  readonly motionPath: LivingMotionPath | string;
  readonly pipeline: typeof LIVING_UI_PIPELINE | string;
  readonly prompt: string;
  readonly runtime: LivingUiRuntimeTarget;
  readonly schemaVersion?: 1;
  readonly spriteSheet: LivingUiSpriteSheet;
  readonly useCase: LivingUiAssetClass | string;
  readonly width: number;
}

export interface FrameRange {
  readonly end: number;
  readonly start: number;
}

export interface PlaybackFrameInput {
  readonly elapsedMs: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly frameRange?: FrameRange;
  readonly reverse?: boolean;
  readonly speed?: number;
}

export interface SpriteFrameRect {
  readonly col: number;
  readonly height: number;
  readonly index: number;
  readonly row: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface RightSizeInput {
  readonly cellHeight: number;
  readonly cellWidth: number;
  readonly density: number;
  readonly displayHeightDp?: number;
  readonly displayWidthDp: number;
}

export interface RightSizeResult {
  readonly maxScale: number;
  readonly pass: boolean;
  readonly requiredHeightPx: number;
  readonly requiredWidthPx: number;
}

export function isLivingUiAssetClass(value: string): value is LivingUiAssetClass {
  return (LIVING_UI_ASSET_CLASSES as readonly string[]).includes(value);
}

export function normalizeFrameRange(frameCount: number, frameRange?: FrameRange): FrameRange {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error("frameCount must be a positive integer");
  }

  const start = Math.max(0, Math.min(frameCount - 1, Math.floor(frameRange?.start ?? 0)));
  const end = Math.max(start, Math.min(frameCount - 1, Math.floor(frameRange?.end ?? frameCount - 1)));
  return { end, start };
}

export function frameIndexAtTimeMs(input: PlaybackFrameInput): number {
  const fps = assertPositiveFinite(input.fps, "fps");
  const speed = input.speed === undefined ? 1 : assertPositiveFinite(input.speed, "speed");
  const frameRange = normalizeFrameRange(input.frameCount, input.frameRange);
  const rangeFrameCount = frameRange.end - frameRange.start + 1;
  const elapsedFrames = Math.floor(Math.max(0, input.elapsedMs) * fps * speed / 1000);
  const offset = elapsedFrames % rangeFrameCount;
  return input.reverse ? frameRange.end - offset : frameRange.start + offset;
}

export function getSpriteFrameRect(
  spriteSheet: Pick<LivingUiSpriteSheet, "cellHeight" | "cellWidth" | "cols" | "frameCount">,
  frameIndex: number,
): SpriteFrameRect {
  if (!Number.isInteger(spriteSheet.cols) || spriteSheet.cols <= 0) {
    throw new Error("spriteSheet.cols must be a positive integer");
  }
  if (!Number.isInteger(spriteSheet.frameCount) || spriteSheet.frameCount <= 0) {
    throw new Error("spriteSheet.frameCount must be a positive integer");
  }
  const index = Math.max(0, Math.min(spriteSheet.frameCount - 1, Math.floor(frameIndex)));
  const col = index % spriteSheet.cols;
  const row = Math.floor(index / spriteSheet.cols);
  return {
    col,
    height: spriteSheet.cellHeight,
    index,
    row,
    width: spriteSheet.cellWidth,
    x: col * spriteSheet.cellWidth,
    y: row * spriteSheet.cellHeight,
  };
}

export function getSpriteSheetTranslate(
  spriteSheet: Pick<LivingUiSpriteSheet, "cellHeight" | "cellWidth" | "cols" | "frameCount">,
  frameIndex: number,
): { readonly translateX: number; readonly translateY: number } {
  const rect = getSpriteFrameRect(spriteSheet, frameIndex);
  return {
    translateX: -rect.x,
    translateY: -rect.y,
  };
}

export function getRightSizeResult(input: RightSizeInput): RightSizeResult {
  const displayWidthDp = assertPositiveFinite(input.displayWidthDp, "displayWidthDp");
  const displayHeightDp = assertPositiveFinite(
    input.displayHeightDp ?? input.displayWidthDp,
    "displayHeightDp",
  );
  const density = assertPositiveFinite(input.density, "density");
  const cellWidth = assertPositiveFinite(input.cellWidth, "cellWidth");
  const cellHeight = assertPositiveFinite(input.cellHeight, "cellHeight");
  const requiredWidthPx = displayWidthDp * density;
  const requiredHeightPx = displayHeightDp * density;
  const maxScale = Math.max(requiredWidthPx / cellWidth, requiredHeightPx / cellHeight);
  return {
    maxScale,
    pass: maxScale <= 1,
    requiredHeightPx,
    requiredWidthPx,
  };
}

export function chooseSpriteSheetExport(
  manifest: Pick<LivingUiManifest, "exports">,
): { readonly format: "webp" | "png"; readonly path: string } {
  if (manifest.exports.spriteSheetWebp) {
    return { format: "webp", path: manifest.exports.spriteSheetWebp };
  }
  if (manifest.exports.spriteSheetPng) {
    return { format: "png", path: manifest.exports.spriteSheetPng };
  }
  throw new Error("manifest does not include a sprite sheet export");
}

export function assertLivingUiManifest(value: unknown): asserts value is LivingUiManifest {
  if (!isRecord(value)) {
    throw new Error("manifest must be an object");
  }
  if (value.pipeline !== LIVING_UI_PIPELINE) {
    throw new Error(`unsupported living UI pipeline: ${String(value.pipeline)}`);
  }
  assertNonEmptyString(value.assetClass, "assetClass");
  assertNonEmptyString(value.assetLabel, "assetLabel");
  assertNonEmptyString(value.aspectRatio, "aspectRatio");
  assertNonEmptyString(value.destination, "destination");
  assertPositiveFinite(value.durationSeconds, "durationSeconds");
  assertNonEmptyString(value.generatedAt, "generatedAt");
  assertPositiveFinite(value.height, "height");
  assertNonEmptyString(value.motionPath, "motionPath");
  assertNonEmptyString(value.prompt, "prompt");
  assertPositiveFinite(value.width, "width");
  if (!isRecord(value.runtime)) {
    throw new Error("runtime must be an object");
  }
  if (!isRecord(value.spriteSheet)) {
    throw new Error("spriteSheet must be an object");
  }
  if (!isRecord(value.exports)) {
    throw new Error("exports must be an object");
  }
  assertPositiveFinite(value.spriteSheet.cellWidth, "spriteSheet.cellWidth");
  assertPositiveFinite(value.spriteSheet.cellHeight, "spriteSheet.cellHeight");
  assertPositiveFinite(value.spriteSheet.cols, "spriteSheet.cols");
  assertPositiveFinite(value.spriteSheet.rows, "spriteSheet.rows");
  assertPositiveFinite(value.spriteSheet.frameCount, "spriteSheet.frameCount");
  assertPositiveFinite(value.spriteSheet.fps, "spriteSheet.fps");
  assertPositiveFinite(value.runtime.densityMax, "runtime.densityMax");
  assertPositiveFinite(value.runtime.displayDpMax, "runtime.displayDpMax");
  assertPositiveFinite(value.runtime.rightSizeMaxScale, "runtime.rightSizeMaxScale");
  chooseSpriteSheetExport(value as unknown as LivingUiManifest);
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function assertPositiveFinite(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive finite number`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type LivingUiDevicePlatform = "ios" | "android";

export type LivingUiInstanceCount = 1 | 10 | 50;

export type LivingUiDensity = 1 | 2 | 3;

export interface LivingUiGateCalibration {
  readonly boilMax: number;
  readonly calibratedAssetIds: readonly string[];
  readonly loopSeamMax: number;
  readonly minFramesByAssetClass: Readonly<Record<string, number>>;
}

export interface LivingUiGenerationGateEvidence {
  readonly assetClass: LivingUiAssetClass | string;
  readonly assetId: string;
  readonly boilScore: number;
  readonly crispCellPxRecorded: boolean;
  readonly founderReviewScore: number;
  readonly frameCount: number;
  readonly loopSeamScore: number;
  readonly maxWhiteBlackDriftPx: number;
  readonly requestedImageSizeHonored: boolean;
}

export interface LivingUiPlatformConsumptionEvidence {
  readonly fpsByInstanceCount: Readonly<Record<LivingUiInstanceCount, number>>;
  readonly interactivityLatencyFrames: number;
  readonly loopSeamless: boolean;
  readonly memoryPassAt50: boolean;
  readonly platform: LivingUiDevicePlatform | string;
  readonly rightSizePassByDensity: Readonly<Record<LivingUiDensity, boolean>>;
}

export interface LivingUiConsumptionGateEvidence {
  readonly platforms: readonly LivingUiPlatformConsumptionEvidence[];
}

export interface LivingUiAssetMvpEvidence {
  readonly assetClass: LivingUiAssetClass | string;
  readonly assetId: string;
  readonly consumption: LivingUiConsumptionGateEvidence;
  readonly generation: LivingUiGenerationGateEvidence;
  readonly rendersThroughRuntimeComponent: boolean;
}

export interface LivingUiAlivenessEvidence {
  readonly discomfortNoWorse: boolean;
  readonly distractionNoWorse: boolean;
  readonly livingPreferredCount: number;
  readonly trialCount: number;
}

export interface LivingUiMvpEvidence {
  readonly aliveness: LivingUiAlivenessEvidence;
  readonly assets: readonly LivingUiAssetMvpEvidence[];
  readonly calibration: LivingUiGateCalibration;
}

export interface LivingUiGateEvaluation {
  readonly pass: boolean;
  readonly reasonCodes: readonly string[];
}

export interface LivingUiAlivenessEvaluation extends LivingUiGateEvaluation {
  readonly pValue: number;
  readonly preferenceRate: number;
}

export interface LivingUiAssetMvpEvaluation extends LivingUiGateEvaluation {
  readonly assetClass: string;
  readonly assetId: string;
  readonly consumption: LivingUiGateEvaluation;
  readonly generation: LivingUiGateEvaluation;
}

export interface LivingUiCoverageEvaluation extends LivingUiGateEvaluation {
  readonly passedClassCount: number;
  readonly passedClasses: readonly LivingUiAssetClass[];
  readonly requiredClassCount: number;
}

export interface LivingUiMvpEvaluation extends LivingUiGateEvaluation {
  readonly aliveness: LivingUiAlivenessEvaluation;
  readonly assets: readonly LivingUiAssetMvpEvaluation[];
  readonly calibration: LivingUiGateEvaluation;
  readonly coverage: LivingUiCoverageEvaluation;
}

const REQUIRED_LIVING_UI_PLATFORMS = ["ios", "android"] as const;
const REQUIRED_LIVING_UI_INSTANCE_COUNTS = [1, 10, 50] as const;
const REQUIRED_LIVING_UI_DENSITIES = [1, 2, 3] as const;
const COVERAGE_CLASS_COUNT_MIN = 4;
const FOUNDER_REVIEW_SCORE_MIN = 4;
const WHITE_BLACK_DRIFT_PX_MAX = 1;
const FPS_MIN = 58;
const INTERACTIVITY_LATENCY_FRAMES_MAX = 1;
const ALIVENESS_TRIAL_COUNT_MIN = 30;
const ALIVENESS_PREFERENCE_RATE_MIN = 0.7;
const ALIVENESS_P_VALUE_MAX = 0.05;
const CALIBRATION_ASSET_COUNT_MIN = 3;

export function evaluateGenerationGate(
  evidence: LivingUiGenerationGateEvidence,
  calibration: LivingUiGateCalibration,
): LivingUiGateEvaluation {
  const reasonCodes: string[] = [];
  const minFrames = calibration.minFramesByAssetClass[evidence.assetClass];

  if (!isPositiveFinite(evidence.founderReviewScore) || evidence.founderReviewScore < FOUNDER_REVIEW_SCORE_MIN) {
    reasonCodes.push("founder_review_below_4");
  }
  if (!isFiniteNumber(evidence.maxWhiteBlackDriftPx) || evidence.maxWhiteBlackDriftPx > WHITE_BLACK_DRIFT_PX_MAX) {
    reasonCodes.push("registration_drift_above_1_px");
  }
  if (!isFiniteNumber(evidence.boilScore) || evidence.boilScore > calibration.boilMax) {
    reasonCodes.push("boil_above_calibrated_max");
  }
  if (!isFiniteNumber(evidence.loopSeamScore) || evidence.loopSeamScore > calibration.loopSeamMax) {
    reasonCodes.push("loop_seam_above_calibrated_max");
  }
  if (!isPositiveFinite(minFrames)) {
    reasonCodes.push("missing_min_frames_calibration");
  } else if (!Number.isInteger(evidence.frameCount) || evidence.frameCount < minFrames) {
    reasonCodes.push("frame_count_below_min");
  }
  if (!evidence.requestedImageSizeHonored) {
    reasonCodes.push("requested_image_size_not_honored");
  }
  if (!evidence.crispCellPxRecorded) {
    reasonCodes.push("crisp_cell_px_not_recorded");
  }

  return buildGateEvaluation(reasonCodes);
}

export function evaluateConsumptionGate(evidence: LivingUiConsumptionGateEvidence): LivingUiGateEvaluation {
  const reasonCodes: string[] = [];

  for (const platform of REQUIRED_LIVING_UI_PLATFORMS) {
    const platformEvidence = evidence.platforms.find((entry) => entry.platform === platform);
    if (!platformEvidence) {
      reasonCodes.push(`missing_${platform}_device_evidence`);
      continue;
    }

    for (const instanceCount of REQUIRED_LIVING_UI_INSTANCE_COUNTS) {
      const fps = platformEvidence.fpsByInstanceCount[instanceCount];
      if (!isFiniteNumber(fps) || fps < FPS_MIN) {
        reasonCodes.push(`${platform}_fps_below_58_at_${instanceCount}`);
      }
    }
    if (!platformEvidence.memoryPassAt50) {
      reasonCodes.push(`${platform}_memory_failed_at_50`);
    }
    for (const density of REQUIRED_LIVING_UI_DENSITIES) {
      if (!platformEvidence.rightSizePassByDensity[density]) {
        reasonCodes.push(`${platform}_right_size_failed_at_density_${density}`);
      }
    }
    if (!platformEvidence.loopSeamless) {
      reasonCodes.push(`${platform}_loop_not_seamless`);
    }
    if (
      !isFiniteNumber(platformEvidence.interactivityLatencyFrames)
      || platformEvidence.interactivityLatencyFrames > INTERACTIVITY_LATENCY_FRAMES_MAX
    ) {
      reasonCodes.push(`${platform}_interaction_latency_above_1_frame`);
    }
  }

  return buildGateEvaluation(reasonCodes);
}

export function evaluateAssetMvpGate(
  evidence: LivingUiAssetMvpEvidence,
  calibration: LivingUiGateCalibration,
): LivingUiAssetMvpEvaluation {
  const generation = evaluateGenerationGate(evidence.generation, calibration);
  const consumption = evaluateConsumptionGate(evidence.consumption);
  const reasonCodes = [
    ...prefixReasonCodes("generation", generation.reasonCodes),
    ...prefixReasonCodes("consumption", consumption.reasonCodes),
  ];

  if (evidence.generation.assetClass !== evidence.assetClass) {
    reasonCodes.push("asset_class_mismatch");
  }
  if (evidence.generation.assetId !== evidence.assetId) {
    reasonCodes.push("asset_id_mismatch");
  }
  if (!evidence.rendersThroughRuntimeComponent) {
    reasonCodes.push("runtime_component_not_rendered");
  }

  return {
    assetClass: evidence.assetClass,
    assetId: evidence.assetId,
    consumption,
    generation,
    ...buildGateEvaluation(reasonCodes),
  };
}

export function evaluateCalibrationGate(calibration: LivingUiGateCalibration): LivingUiGateEvaluation {
  const reasonCodes: string[] = [];

  if (!isPositiveFinite(calibration.boilMax)) {
    reasonCodes.push("missing_boil_max_calibration");
  }
  if (!isPositiveFinite(calibration.loopSeamMax)) {
    reasonCodes.push("missing_loop_seam_max_calibration");
  }
  if (calibration.calibratedAssetIds.length < CALIBRATION_ASSET_COUNT_MIN) {
    reasonCodes.push("calibration_sample_too_small");
  }
  for (const assetClass of LIVING_UI_ASSET_CLASSES) {
    if (!isPositiveFinite(calibration.minFramesByAssetClass[assetClass])) {
      reasonCodes.push(`missing_min_frames_for_${assetClass}`);
    }
  }

  return buildGateEvaluation(reasonCodes);
}

export function evaluateAlivenessGate(evidence: LivingUiAlivenessEvidence): LivingUiAlivenessEvaluation {
  const reasonCodes: string[] = [];
  const preferenceRate = evidence.trialCount <= 0 ? 0 : evidence.livingPreferredCount / evidence.trialCount;
  const pValue = binomialRightTailProbability(evidence.livingPreferredCount, evidence.trialCount);

  if (!Number.isInteger(evidence.trialCount) || evidence.trialCount < ALIVENESS_TRIAL_COUNT_MIN) {
    reasonCodes.push("aliveness_trial_count_below_30");
  }
  if (
    !Number.isInteger(evidence.livingPreferredCount)
    || evidence.livingPreferredCount < 0
    || evidence.livingPreferredCount > evidence.trialCount
  ) {
    reasonCodes.push("aliveness_preference_count_invalid");
  }
  if (preferenceRate < ALIVENESS_PREFERENCE_RATE_MIN) {
    reasonCodes.push("aliveness_effect_below_70_30");
  }
  if (pValue >= ALIVENESS_P_VALUE_MAX) {
    reasonCodes.push("aliveness_p_value_not_significant");
  }
  if (!evidence.distractionNoWorse) {
    reasonCodes.push("distraction_guardrail_failed");
  }
  if (!evidence.discomfortNoWorse) {
    reasonCodes.push("discomfort_guardrail_failed");
  }

  return {
    pValue,
    preferenceRate,
    ...buildGateEvaluation(reasonCodes),
  };
}

export function evaluateLivingUiMvp(evidence: LivingUiMvpEvidence): LivingUiMvpEvaluation {
  const calibration = evaluateCalibrationGate(evidence.calibration);
  const assets = evidence.assets.map((asset) => evaluateAssetMvpGate(asset, evidence.calibration));
  const aliveness = evaluateAlivenessGate(evidence.aliveness);
  const passedClasses = uniqueLivingUiAssetClasses(
    assets
      .filter((asset) => asset.pass)
      .map((asset) => asset.assetClass),
  );
  const coverageReasonCodes: string[] = [];

  if (passedClasses.length < COVERAGE_CLASS_COUNT_MIN) {
    coverageReasonCodes.push("coverage_below_4_of_5_classes");
  }

  const coverage: LivingUiCoverageEvaluation = {
    passedClassCount: passedClasses.length,
    passedClasses,
    requiredClassCount: COVERAGE_CLASS_COUNT_MIN,
    ...buildGateEvaluation(coverageReasonCodes),
  };
  const reasonCodes = [
    ...prefixReasonCodes("calibration", calibration.reasonCodes),
    ...prefixReasonCodes("coverage", coverage.reasonCodes),
    ...prefixReasonCodes("aliveness", aliveness.reasonCodes),
  ];

  return {
    aliveness,
    assets,
    calibration,
    coverage,
    ...buildGateEvaluation(reasonCodes),
  };
}

export function binomialRightTailProbability(successes: number, trials: number, p = 0.5): number {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials < 0 || p < 0 || p > 1) {
    return 1;
  }
  if (successes <= 0) {
    return 1;
  }
  if (successes > trials) {
    return 0;
  }
  if (p === 0) {
    return successes <= 0 ? 1 : 0;
  }
  if (p === 1) {
    return successes <= trials ? 1 : 0;
  }

  let probabilityMass = (1 - p) ** trials;
  let tail = 0;
  for (let k = 0; k <= trials; k++) {
    if (k >= successes) {
      tail += probabilityMass;
    }
    if (k < trials) {
      probabilityMass *= ((trials - k) / (k + 1)) * (p / (1 - p));
    }
  }
  return Math.max(0, Math.min(1, tail));
}

function uniqueLivingUiAssetClasses(values: readonly string[]): LivingUiAssetClass[] {
  const unique = new Set<LivingUiAssetClass>();
  for (const value of values) {
    if (isLivingUiAssetClass(value)) {
      unique.add(value);
    }
  }
  return LIVING_UI_ASSET_CLASSES.filter((assetClass) => unique.has(assetClass));
}

function prefixReasonCodes(prefix: string, reasonCodes: readonly string[]): string[] {
  return reasonCodes.map((reasonCode) => `${prefix}_${reasonCode}`);
}

function buildGateEvaluation(reasonCodes: readonly string[]): LivingUiGateEvaluation {
  return {
    pass: reasonCodes.length === 0,
    reasonCodes,
  };
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
