/**
 * Truth-referenced quality metrics for the Alpha Compiler evaluation loop.
 *
 * Every metric compares compiler output against known RGBA ground truth, so none of
 * them are tautological: a passthrough branch scores exactly as well as its pixels
 * actually match the truth.
 *
 * Conventions:
 * - All error metrics are normalized to 0..1 (alpha and RGB deltas divided by 255).
 * - Metrics that have no qualifying pixels in a frame report null for that frame and
 *   are excluded from aggregation for that frame.
 * - "Worst frame" is the 1-based frame number (matching frame-%05d.png artifacts)
 *   where the metric was worst (max for lower-is-better, min for higher-is-better).
 */

import { chamferDistanceToMask, keyDominance, type RgbColor } from "./core.js";

/** Truth alpha >= this counts as "should be opaque" for misclassification rates. */
export const OPAQUE_TRUTH_THRESHOLD = 192;
/** Truth alpha <= this counts as "should be transparent" for misclassification rates. */
export const TRANSPARENT_TRUTH_THRESHOLD = 16;
/** Output alpha at or below this counts as a false-transparent miss inside opaque truth. */
export const FALSE_TRANSPARENT_OUTPUT_THRESHOLD = 64;
/** Output alpha at or above this counts as a false-opaque hit inside transparent truth. */
export const FALSE_OPAQUE_OUTPUT_THRESHOLD = 64;
/** Truth alpha range treated as genuinely soft/partial coverage. */
export const SOFT_TRUTH_MIN = 16;
export const SOFT_TRUTH_MAX = 239;
/** Output alpha outside (BINARY_LOW, BINARY_HIGH) counts as binarized in soft regions. */
export const BINARY_LOW = 8;
export const BINARY_HIGH = 247;
/** Edge band half-width in pixels around the truth opacity boundary. */
export const EDGE_BAND_RADIUS = 2;

export interface FrameMetrics {
	/** Mean |outA - truthA| over all pixels. */
	readonly alphaMae: number;
	/** Sum(min(outA, truthA)) / sum(truthA) over detached-element pixels. Higher is better. */
	readonly detachedAlphaRecall: number | null;
	/** Mean RGB error over detached pixels with solid truth and visible output. */
	readonly detachedRgbMae: number | null;
	/** Mean |outA - truthA| over the truth edge band. */
	readonly edgeAlphaMae: number | null;
	/** Truth-alpha-weighted mean RGB error over the truth edge band. */
	readonly edgeRgbMae: number | null;
	/** Fraction of transparent-truth pixels rendered substantially opaque. */
	readonly falseOpaqueRate: number | null;
	/** Fraction of opaque-truth pixels rendered substantially transparent. */
	readonly falseTransparentRate: number | null;
	/** Mean RGB error over solidly-opaque truth pixels with visible output. */
	readonly fgRgbMae: number | null;
	/** Mean |priorA - truthA| over all pixels; context floor, not a compiler metric. */
	readonly priorAlphaMae: number | null;
	/** Mean key-dominance excess of output RGB over truth RGB on visible pixels. */
	readonly residualSpill: number | null;
	/** Fraction of soft-truth pixels the output pushed to nearly 0 or nearly 255 alpha. */
	readonly softBinarizationRate: number | null;
	/** Mean |outA - truthA| over genuinely soft truth pixels. */
	readonly softAlphaMae: number | null;
	/** Mean |(outA_t - outA_t-1) - (truthA_t - truthA_t-1)|: alpha change not explained by truth motion. */
	readonly temporalAlphaInstability: number | null;
}

export type MetricName = keyof FrameMetrics;

export type MetricDirection = "higher-is-better" | "lower-is-better";

export const METRIC_DIRECTIONS: Readonly<Record<MetricName, MetricDirection>> = {
	alphaMae: "lower-is-better",
	detachedAlphaRecall: "higher-is-better",
	detachedRgbMae: "lower-is-better",
	edgeAlphaMae: "lower-is-better",
	edgeRgbMae: "lower-is-better",
	falseOpaqueRate: "lower-is-better",
	falseTransparentRate: "lower-is-better",
	fgRgbMae: "lower-is-better",
	priorAlphaMae: "lower-is-better",
	residualSpill: "lower-is-better",
	softAlphaMae: "lower-is-better",
	softBinarizationRate: "lower-is-better",
	temporalAlphaInstability: "lower-is-better",
};

export const METRIC_NAMES = Object.keys(METRIC_DIRECTIONS) as readonly MetricName[];

export interface FrameMetricsInput {
	readonly detachedMask: Uint8Array;
	readonly height: number;
	readonly keyColor: RgbColor;
	/** Output RGBA from the compiler, straight alpha. */
	readonly output: Buffer;
	readonly previousOutputAlpha?: Uint8Array;
	readonly previousTruthAlpha?: Uint8Array;
	readonly priorAlpha?: Uint8Array;
	/** Ground-truth RGBA, straight alpha. */
	readonly truth: Buffer;
	readonly width: number;
}

/**
 * Pixels considered "edge" relative to truth: within EDGE_BAND_RADIUS of the binary
 * opacity boundary, plus every genuinely soft truth pixel.
 */
export function buildTruthEdgeMask(truthAlpha: Uint8Array, width: number, height: number): Uint8Array {
	const pixelCount = width * height;
	const boundary = new Uint8Array(pixelCount);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			const inside = truthAlpha[pixel] >= 128;
			const rightDiffers = x + 1 < width && (truthAlpha[pixel + 1] >= 128) !== inside;
			const downDiffers = y + 1 < height && (truthAlpha[pixel + width] >= 128) !== inside;
			if (rightDiffers || downDiffers) {
				boundary[pixel] = 1;
				if (rightDiffers) {
					boundary[pixel + 1] = 1;
				}
				if (downDiffers) {
					boundary[pixel + width] = 1;
				}
			}
		}
	}
	const distances = chamferDistanceToMask(boundary, width, height, EDGE_BAND_RADIUS);
	const edge = new Uint8Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const soft = truthAlpha[pixel] > BINARY_LOW && truthAlpha[pixel] < BINARY_HIGH;
		if (distances[pixel] <= EDGE_BAND_RADIUS || soft) {
			edge[pixel] = 1;
		}
	}
	return edge;
}

export function extractAlphaChannel(rgba: Buffer, pixelCount: number): Uint8Array {
	const alpha = new Uint8Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		alpha[pixel] = rgba[pixel * 4 + 3];
	}
	return alpha;
}

function rgbMaeAt(truth: Buffer, output: Buffer, pixel: number): number {
	const offset = pixel * 4;
	return (
		Math.abs(output[offset] - truth[offset])
		+ Math.abs(output[offset + 1] - truth[offset + 1])
		+ Math.abs(output[offset + 2] - truth[offset + 2])
	) / 3;
}

export function computeFrameMetrics(input: FrameMetricsInput): FrameMetrics {
	const { detachedMask, height, keyColor, output, previousOutputAlpha, previousTruthAlpha, priorAlpha, truth, width } = input;
	const pixelCount = width * height;
	if (truth.length !== pixelCount * 4 || output.length !== pixelCount * 4) {
		throw new Error("Truth/output buffer size does not match frame dimensions.");
	}
	const truthAlpha = extractAlphaChannel(truth, pixelCount);
	const outputAlpha = extractAlphaChannel(output, pixelCount);
	const edgeMask = buildTruthEdgeMask(truthAlpha, width, height);

	let alphaErrorSum = 0;
	let edgeAlphaErrorSum = 0;
	let edgeCount = 0;
	let edgeRgbErrorSum = 0;
	let edgeRgbWeightSum = 0;
	let fgRgbErrorSum = 0;
	let fgRgbCount = 0;
	let opaqueTruthCount = 0;
	let falseTransparentCount = 0;
	let transparentTruthCount = 0;
	let falseOpaqueCount = 0;
	let spillSum = 0;
	let spillCount = 0;
	let softErrorSum = 0;
	let softCount = 0;
	let softBinarizedCount = 0;
	let detachedTruthAlphaSum = 0;
	let detachedOverlapSum = 0;
	let detachedRgbErrorSum = 0;
	let detachedRgbCount = 0;
	let temporalSum = 0;
	let priorErrorSum = 0;

	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const ta = truthAlpha[pixel];
		const oa = outputAlpha[pixel];
		const alphaError = Math.abs(oa - ta);
		alphaErrorSum += alphaError;

		if (edgeMask[pixel] === 1) {
			edgeAlphaErrorSum += alphaError;
			edgeCount += 1;
			if (ta >= SOFT_TRUTH_MIN && oa > BINARY_LOW) {
				const weight = ta / 255;
				edgeRgbErrorSum += rgbMaeAt(truth, output, pixel) * weight;
				edgeRgbWeightSum += weight;
			}
		}

		if (ta >= OPAQUE_TRUTH_THRESHOLD) {
			opaqueTruthCount += 1;
			if (oa <= FALSE_TRANSPARENT_OUTPUT_THRESHOLD) {
				falseTransparentCount += 1;
			}
			if (oa > SOFT_TRUTH_MIN) {
				fgRgbErrorSum += rgbMaeAt(truth, output, pixel);
				fgRgbCount += 1;
			}
		} else if (ta <= TRANSPARENT_TRUTH_THRESHOLD) {
			transparentTruthCount += 1;
			if (oa >= FALSE_OPAQUE_OUTPUT_THRESHOLD) {
				falseOpaqueCount += 1;
			}
		}

		if (ta >= SOFT_TRUTH_MIN && oa >= SOFT_TRUTH_MIN) {
			const truthOffset = pixel * 4;
			const truthDominance = keyDominance(truth[truthOffset], truth[truthOffset + 1], truth[truthOffset + 2], keyColor);
			const outputDominance = keyDominance(output[truthOffset], output[truthOffset + 1], output[truthOffset + 2], keyColor);
			spillSum += Math.max(0, outputDominance - truthDominance);
			spillCount += 1;
		}

		if (ta >= SOFT_TRUTH_MIN && ta <= SOFT_TRUTH_MAX) {
			softErrorSum += alphaError;
			softCount += 1;
			if (oa <= BINARY_LOW || oa >= BINARY_HIGH) {
				softBinarizedCount += 1;
			}
		}

		if (detachedMask[pixel] === 1) {
			detachedTruthAlphaSum += ta;
			detachedOverlapSum += Math.min(oa, ta);
			if (ta >= 128 && oa > SOFT_TRUTH_MIN) {
				detachedRgbErrorSum += rgbMaeAt(truth, output, pixel);
				detachedRgbCount += 1;
			}
		}

		if (previousOutputAlpha && previousTruthAlpha) {
			const outputDelta = oa - previousOutputAlpha[pixel];
			const truthDelta = ta - previousTruthAlpha[pixel];
			temporalSum += Math.abs(outputDelta - truthDelta);
		}

		if (priorAlpha) {
			priorErrorSum += Math.abs(priorAlpha[pixel] - ta);
		}
	}

	return {
		alphaMae: alphaErrorSum / pixelCount / 255,
		detachedAlphaRecall: detachedTruthAlphaSum === 0 ? null : detachedOverlapSum / detachedTruthAlphaSum,
		detachedRgbMae: detachedRgbCount === 0 ? null : detachedRgbErrorSum / detachedRgbCount / 255,
		edgeAlphaMae: edgeCount === 0 ? null : edgeAlphaErrorSum / edgeCount / 255,
		edgeRgbMae: edgeRgbWeightSum === 0 ? null : edgeRgbErrorSum / edgeRgbWeightSum / 255,
		falseOpaqueRate: transparentTruthCount === 0 ? null : falseOpaqueCount / transparentTruthCount,
		falseTransparentRate: opaqueTruthCount === 0 ? null : falseTransparentCount / opaqueTruthCount,
		fgRgbMae: fgRgbCount === 0 ? null : fgRgbErrorSum / fgRgbCount / 255,
		priorAlphaMae: priorAlpha ? priorErrorSum / pixelCount / 255 : null,
		residualSpill: spillCount === 0 ? null : spillSum / spillCount / 255,
		softAlphaMae: softCount === 0 ? null : softErrorSum / softCount / 255,
		softBinarizationRate: softCount === 0 ? null : softBinarizedCount / softCount,
		temporalAlphaInstability: previousOutputAlpha && previousTruthAlpha ? temporalSum / pixelCount / 255 : null,
	};
}

export interface MetricAggregate {
	readonly direction: MetricDirection;
	/** Number of frames where the metric was defined. */
	readonly frames: number;
	readonly max: number;
	readonly mean: number;
	readonly min: number;
	/** 1-based frame number of the worst value; 0 when the metric never applied. */
	readonly worstFrame: number;
	readonly worstValue: number;
}

export function aggregateFrameMetrics(frames: readonly FrameMetrics[]): Record<MetricName, MetricAggregate> {
	const result = {} as Record<MetricName, MetricAggregate>;
	for (const metric of METRIC_NAMES) {
		const direction = METRIC_DIRECTIONS[metric];
		let sum = 0;
		let count = 0;
		let max = Number.NEGATIVE_INFINITY;
		let min = Number.POSITIVE_INFINITY;
		let worstFrame = 0;
		let worstValue = direction === "lower-is-better" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
		for (let index = 0; index < frames.length; index += 1) {
			const value = frames[index][metric];
			if (value === null) {
				continue;
			}
			sum += value;
			count += 1;
			max = Math.max(max, value);
			min = Math.min(min, value);
			const isWorse = direction === "lower-is-better" ? value > worstValue : value < worstValue;
			if (isWorse) {
				worstValue = value;
				worstFrame = index + 1;
			}
		}
		result[metric] = count === 0
			? { direction, frames: 0, max: 0, mean: 0, min: 0, worstFrame: 0, worstValue: 0 }
			: {
				direction,
				frames: count,
				max,
				mean: sum / count,
				min,
				worstFrame,
				worstValue,
			};
	}
	return result;
}
