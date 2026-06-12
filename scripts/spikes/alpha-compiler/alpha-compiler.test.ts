import { describe, expect, it } from "vitest";
import {
	assertComparableEvalReport,
	buildBaseline,
	compareReportToBaseline,
	defaultTolerance,
	selectScenariosForCompare,
	type BaselineFile,
	type ScenarioAggregates,
} from "./baseline.js";
import {
	chamferDistanceToMask,
	COLOR_LINE_MAX_WEIGHT,
	COLOR_LINE_MIN_SEPARATION,
	createV6RgbaFrame,
	createV7RgbaFrame,
	distanceToTransparent,
	estimateColorLineAlpha,
	fillInwardCoreColors,
	fuseAlphaWithColorLine,
	keyDominance,
	normalizeHexColor,
	parseRgbColor,
	projectDecontaminate,
	recoverForegroundRgb,
	rgbToHex,
	summarizeMetric,
	type RawGrayImage,
	type RawRgbImage,
	type V6ProjectionSettings,
} from "./core.js";
import {
	aggregateFrameMetrics,
	buildTruthEdgeMask,
	computeFrameMetrics,
	METRIC_DIRECTIONS,
	METRIC_NAMES,
	type FrameMetrics,
	type MetricAggregate,
	type MetricName,
} from "./metrics.js";
import { CANONICAL_SCENARIO_IDS, compositeOverPlate, createScenarios, DEFAULT_SCENARIO_OPTIONS } from "./truth.js";

function grayImage(width: number, height: number, fill: (x: number, y: number) => number): RawGrayImage {
	const data = Buffer.alloc(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			data[y * width + x] = fill(x, y);
		}
	}
	return { data, height, width };
}

function rgbImage(width: number, height: number, fill: (x: number, y: number) => readonly [number, number, number]): RawRgbImage {
	const data = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const [r, g, b] = fill(x, y);
			const offset = (y * width + x) * 3;
			data[offset] = r;
			data[offset + 1] = g;
			data[offset + 2] = b;
		}
	}
	return { data, height, width };
}

function rgbaFrame(
	width: number,
	height: number,
	fill: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
	const data = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const [r, g, b, a] = fill(x, y);
			const offset = (y * width + x) * 4;
			data[offset] = r;
			data[offset + 1] = g;
			data[offset + 2] = b;
			data[offset + 3] = a;
		}
	}
	return data;
}

describe("color helpers", () => {
	it("normalizes and parses hex colors in #, 0x, and bare forms", () => {
		expect(normalizeHexColor("0x23AF42")).toBe("#23af42");
		expect(normalizeHexColor(" #2040FF ")).toBe("#2040ff");
		expect(parseRgbColor("#23af42")).toEqual({ b: 0x42, g: 0xaf, r: 0x23 });
		expect(rgbToHex({ b: 0x42, g: 0xaf, r: 0x23 })).toBe("#23af42");
		expect(() => normalizeHexColor("#abc")).toThrow();
	});

	it("computes key dominance for green, blue, and red keys", () => {
		const green = parseRgbColor("#23af42");
		const blue = parseRgbColor("#2040ff");
		const red = parseRgbColor("#ff2020");
		expect(keyDominance(50, 200, 60, green)).toBe(140);
		expect(keyDominance(200, 50, 60, green)).toBe(0);
		expect(keyDominance(40, 60, 220, blue)).toBe(160);
		expect(keyDominance(220, 40, 60, red)).toBe(160);
	});
});

describe("summarizeMetric", () => {
	it("returns zeros with frame 0 for empty input", () => {
		expect(summarizeMetric([])).toEqual({ average: 0, max: 0, maxFrame: 0, min: 0, minFrame: 0 });
	});

	it("reports 1-based max/min frame locations", () => {
		const summary = summarizeMetric([0.2, 0.9, 0.1, 0.9]);
		expect(summary.max).toBe(0.9);
		expect(summary.maxFrame).toBe(2);
		expect(summary.min).toBe(0.1);
		expect(summary.minFrame).toBe(3);
		expect(summary.average).toBeCloseTo(0.525, 4);
	});
});

describe("distance transforms", () => {
	it("distanceToTransparent measures chebyshev distance from transparent pixels", () => {
		// Single transparent pixel at (0,0) in an otherwise opaque 5x5 image.
		const alpha = grayImage(5, 5, (x, y) => (x === 0 && y === 0 ? 0 : 255));
		const distances = distanceToTransparent(alpha, 2, 10);
		expect(distances[0]).toBe(0);
		expect(distances[1]).toBe(1);
		expect(distances[6]).toBe(1); // diagonal neighbor (1,1)
		expect(distances[24]).toBe(4); // far corner (4,4)
	});

	it("caps distances at maxDistance + 1", () => {
		const alpha = grayImage(8, 1, (x) => (x === 0 ? 0 : 255));
		const distances = distanceToTransparent(alpha, 2, 3);
		expect(distances[7]).toBe(4);
	});

	it("chamferDistanceToMask measures distance to the mask", () => {
		const mask = new Uint8Array(25);
		mask[12] = 1; // center of 5x5
		const distances = chamferDistanceToMask(mask, 5, 5, 10);
		expect(distances[12]).toBe(0);
		expect(distances[11]).toBe(1);
		expect(distances[0]).toBe(2);
	});
});

describe("fillInwardCoreColors", () => {
	it("propagates seed colors outward one ring per iteration", () => {
		const frame = rgbImage(5, 1, (x) => (x === 0 ? [200, 10, 30] : [0, 0, 0]));
		const seed = new Uint8Array(5);
		seed[0] = 1;
		const { colors, filled } = fillInwardCoreColors(frame, seed, 2);
		expect(filled[0]).toBe(1);
		expect(filled[1]).toBe(1);
		expect(filled[2]).toBe(1);
		expect(filled[3]).toBe(0); // beyond 2 iterations
		expect(colors[1 * 3]).toBe(200);
		expect(colors[2 * 3]).toBe(200);
	});
});

describe("projectDecontaminate", () => {
	const ref = [200, 40, 40] as const;
	const bg = [40, 200, 40] as const;

	it("returns the reference color when the source equals the background", () => {
		const out = projectDecontaminate(bg[0], bg[1], bg[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2], 1);
		expect(out.t).toBe(1);
		expect([out.r, out.g, out.b]).toEqual([ref[0], ref[1], ref[2]]);
	});

	it("leaves the source untouched when it equals the reference", () => {
		const out = projectDecontaminate(ref[0], ref[1], ref[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2], 1);
		expect(out.t).toBe(0);
		expect([out.r, out.g, out.b]).toEqual([ref[0], ref[1], ref[2]]);
	});

	it("projects the axis midpoint all the way back to the reference", () => {
		// mid = ref + 0.5 * (bg - ref); subtracting t*(bg - ref) with t = 0.5 lands on ref.
		const mid = [120, 120, 40] as const;
		const out = projectDecontaminate(mid[0], mid[1], mid[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2], 1);
		expect(out.t).toBeCloseTo(0.5, 5);
		expect([out.r, out.g, out.b]).toEqual([ref[0], ref[1], ref[2]]);
	});

	it("scales projection by strength", () => {
		const out = projectDecontaminate(bg[0], bg[1], bg[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2], 0.5);
		expect(out.t).toBeCloseTo(0.5, 5);
	});

	it("passes through when background and reference are degenerate", () => {
		const out = projectDecontaminate(99, 88, 77, 100, 100, 100, 100, 100, 100, 1);
		expect(out.t).toBe(0);
		expect([out.r, out.g, out.b]).toEqual([99, 88, 77]);
	});

	it("clamps t to [0, 1] beyond the background", () => {
		const beyond = [0, 255, 40] as const;
		const out = projectDecontaminate(beyond[0], beyond[1], beyond[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2], 1);
		expect(out.t).toBe(1);
	});
});

function v6TestSettings(keyColor: string): V6ProjectionSettings {
	return {
		bgPlateIterations: 24,
		chromaTransparentCutoff: 8,
		coreAlphaThreshold: 235,
		coreProjectionBand: 6,
		fringeRadius: 2,
		guardRadius: 3,
		keyColor,
		leafAlphaFloor: 24,
		leafEdgeBand: 2,
		leafGateRamp: 2,
		leafInteriorMinDistance: 1,
		priorAlphaDir: "test",
		priorModel: "test",
		priorPackage: "test",
		selectedFrame: 1,
		subjectAlphaThreshold: 32,
		transparentCutoff: 2,
	};
}

describe("createV6RgbaFrame", () => {
	const width = 48;
	const height = 32;
	const key = parseRgbColor("#23af42");
	const subject = { b: 30, g: 60, r: 220 };
	const inSubject = (x: number, y: number): boolean => x >= 6 && x <= 21 && y >= 8 && y <= 23;
	// Detached blob far from the subject (distance > guardRadius + ramp).
	const inBlob = (x: number, y: number): boolean => x >= 36 && x <= 43 && y >= 12 && y <= 19;

	const frame = rgbImage(width, height, (x, y) => {
		if (inSubject(x, y) || inBlob(x, y)) {
			return [subject.r, subject.g, subject.b];
		}
		return [key.r, key.g, key.b];
	});
	const priorAlpha = grayImage(width, height, (x, y) => (inSubject(x, y) ? 255 : 0));
	const chromaAlpha = grayImage(width, height, (x, y) => (inSubject(x, y) || inBlob(x, y) ? 255 : 0));

	it("keeps the subject opaque, background transparent, and re-adds detached elements", () => {
		const result = createV6RgbaFrame(frame, priorAlpha, chromaAlpha, v6TestSettings("#23af42"), undefined, false);
		const pixelAt = (x: number, y: number): readonly [number, number, number, number] => {
			const offset = (y * width + x) * 4;
			return [result.data[offset], result.data[offset + 1], result.data[offset + 2], result.data[offset + 3]];
		};
		// Subject interior: opaque, original color.
		expect(pixelAt(14, 16)[3]).toBe(255);
		expect(pixelAt(14, 16)[0]).toBe(subject.r);
		// Background: fully transparent.
		expect(pixelAt(2, 2)[3]).toBe(0);
		expect(pixelAt(30, 5)[3]).toBe(0);
		// Detached blob interior: visible via the leaf path despite zero prior.
		expect(pixelAt(40, 16)[3]).toBeGreaterThan(200);
		expect(result.leafAddedCoverage).toBeGreaterThan(0);
		expect(result.coreCoverage).toBeGreaterThan(0);
		expect(result.priorCoverage).toBeGreaterThan(0);
	});

	it("reports temporal alpha delta against the previous frame inside the subject", () => {
		const settings = v6TestSettings("#23af42");
		const first = createV6RgbaFrame(frame, priorAlpha, chromaAlpha, settings, undefined, false);
		expect(first.temporalAlphaDelta).toBe(0);
		const previous = new Uint8Array(width * height);
		// Pretend the previous frame had a half-transparent subject.
		for (let pixel = 0; pixel < previous.length; pixel += 1) {
			previous[pixel] = priorAlpha.data[pixel] === 255 ? 128 : 0;
		}
		const second = createV6RgbaFrame(frame, priorAlpha, chromaAlpha, settings, previous, false);
		expect(second.temporalAlphaDelta).toBeGreaterThan(100);
	});

	it("rejects mismatched dimensions", () => {
		const tiny = grayImage(4, 4, () => 0);
		expect(() => createV6RgbaFrame(frame, tiny, chromaAlpha, v6TestSettings("#23af42"), undefined, false)).toThrow();
	});
});

describe("estimateColorLineAlpha", () => {
	const ref = [200, 40, 40] as const;
	const bg = [40, 200, 40] as const;

	function mix(alpha: number): readonly [number, number, number] {
		return [
			ref[0] * alpha + bg[0] * (1 - alpha),
			ref[1] * alpha + bg[1] * (1 - alpha),
			ref[2] * alpha + bg[2] * (1 - alpha),
		];
	}

	it("recovers the exact mix ratio for on-line pixels with full confidence", () => {
		const src = mix(0.7);
		const estimate = estimateColorLineAlpha(src[0], src[1], src[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2]);
		expect(estimate.alpha).toBeCloseTo(0.7, 5);
		expect(estimate.offLineRatio).toBeCloseTo(0, 5);
		expect(estimate.confidence).toBeCloseTo(1, 5);
	});

	it("reports zero confidence when ref and bg are too close to disambiguate", () => {
		const estimate = estimateColorLineAlpha(105, 105, 105, 100, 100, 100, 110, 110, 110);
		expect(estimate.separation).toBeLessThan(COLOR_LINE_MIN_SEPARATION);
		expect(estimate.confidence).toBe(0);
	});

	it("collapses confidence for colors far off the ref-bg line", () => {
		const estimate = estimateColorLineAlpha(40, 40, 220, ref[0], ref[1], ref[2], bg[0], bg[1], bg[2]);
		expect(estimate.confidence).toBe(0);
	});

	it("clamps the projection to [0, 1]", () => {
		const beyondBg = [0, 255, 40] as const;
		const estimate = estimateColorLineAlpha(beyondBg[0], beyondBg[1], beyondBg[2], ref[0], ref[1], ref[2], bg[0], bg[1], bg[2]);
		expect(estimate.alpha).toBe(0);
	});
});

describe("fuseAlphaWithColorLine", () => {
	const confident = (alpha: number, separation = 200) => ({ alpha, confidence: 1, offLineRatio: 0, separation });

	it("defers to the baseline when the implied color shift is below the noise floor", () => {
		// |0.5 - 0.4| * 18 = 1.8 implied color units: indistinguishable from noise.
		expect(fuseAlphaWithColorLine(102, confident(0.5, 18), true)).toBe(102);
	});

	it("applies strong disagreements at the capped weight", () => {
		const fused = fuseAlphaWithColorLine(0, confident(1), true);
		expect(fused).toBe(Math.round(COLOR_LINE_MAX_WEIGHT * 255));
	});

	it("never raises alpha when allowRaise is false", () => {
		expect(fuseAlphaWithColorLine(100, confident(1), false)).toBe(100);
	});

	it("always allows downward corrections", () => {
		const fused = fuseAlphaWithColorLine(200, confident(0), false);
		expect(fused).toBe(Math.round(200 - COLOR_LINE_MAX_WEIGHT * 200));
	});

	it("scales corrections by estimate confidence", () => {
		const halfConfident = { alpha: 1, confidence: 0.5, offLineRatio: 0, separation: 200 };
		const fused = fuseAlphaWithColorLine(0, halfConfident, true);
		expect(fused).toBe(Math.round(0.5 * COLOR_LINE_MAX_WEIGHT * 255));
	});
});

describe("recoverForegroundRgb", () => {
	const fg = [220, 60, 30] as const;
	const bg = [40, 200, 40] as const;

	it("inverts compositing exactly when alpha is exact", () => {
		const alpha = 0.4;
		const src = [
			fg[0] * alpha + bg[0] * (1 - alpha),
			fg[1] * alpha + bg[1] * (1 - alpha),
			fg[2] * alpha + bg[2] * (1 - alpha),
		] as const;
		const out = recoverForegroundRgb(src[0], src[1], src[2], bg[0], bg[1], bg[2], alpha, 8);
		expect([out.r, out.g, out.b]).toEqual([fg[0], fg[1], fg[2]]);
	});

	it("passes opaque pixels through untouched", () => {
		const out = recoverForegroundRgb(123, 45, 67, bg[0], bg[1], bg[2], 1, 8);
		expect([out.r, out.g, out.b]).toEqual([123, 45, 67]);
	});

	it("caps the gain at low alpha instead of amplifying noise unboundedly", () => {
		// alpha 0.05 implies gain 19; the cap of 2 limits the correction.
		const out = recoverForegroundRgb(50, 190, 41, bg[0], bg[1], bg[2], 0.05, 2);
		expect(out.r).toBe(50 + 2 * (50 - bg[0]));
		expect(out.g).toBe(190 + 2 * (190 - bg[1]));
	});

	it("clamps the recovered color to byte range", () => {
		const out = recoverForegroundRgb(250, 5, 128, 40, 200, 128, 0.5, 8);
		expect(out.r).toBe(255);
		expect(out.g).toBe(0);
		expect(out.b).toBe(128);
	});
});

describe("createV7RgbaFrame", () => {
	const width = 48;
	const height = 32;
	const key = parseRgbColor("#23af42");
	const subject = { b: 30, g: 60, r: 220 };
	const inSubject = (x: number, y: number): boolean => x >= 6 && x <= 21 && y >= 8 && y <= 23;
	const inBlob = (x: number, y: number): boolean => x >= 36 && x <= 43 && y >= 12 && y <= 19;
	// Soft halo column just right of the blob: 30% subject color over the plate.
	const inHalo = (x: number, y: number): boolean => x === 44 && y >= 13 && y <= 18;

	const halo = {
		b: Math.round(subject.b * 0.3 + key.b * 0.7),
		g: Math.round(subject.g * 0.3 + key.g * 0.7),
		r: Math.round(subject.r * 0.3 + key.r * 0.7),
	};
	const frame = rgbImage(width, height, (x, y) => {
		if (inSubject(x, y) || inBlob(x, y)) {
			return [subject.r, subject.g, subject.b];
		}
		if (inHalo(x, y)) {
			return [halo.r, halo.g, halo.b];
		}
		return [key.r, key.g, key.b];
	});
	const priorAlpha = grayImage(width, height, (x, y) => (inSubject(x, y) ? 255 : 0));
	const chromaAlpha = grayImage(width, height, (x, y) => (inSubject(x, y) || inBlob(x, y) ? 255 : 0));

	function pixelAt(data: Buffer, x: number, y: number): readonly [number, number, number, number] {
		const offset = (y * width + x) * 4;
		return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
	}

	it("keeps v6 invariants: opaque subject, transparent background, detached re-add", () => {
		const result = createV7RgbaFrame(frame, priorAlpha, chromaAlpha, v6TestSettings("#23af42"), undefined, false);
		expect(pixelAt(result.data, 14, 16)[3]).toBe(255);
		expect(pixelAt(result.data, 14, 16)[0]).toBe(subject.r);
		expect(pixelAt(result.data, 2, 2)[3]).toBe(0);
		expect(pixelAt(result.data, 30, 5)[3]).toBe(0);
		expect(pixelAt(result.data, 40, 16)[3]).toBeGreaterThan(200);
		expect(result.leafAddedCoverage).toBeGreaterThan(0);
		expect(result.coreCoverage).toBeGreaterThan(0);
	});

	it("preserves detached interior RGB exactly", () => {
		const result = createV7RgbaFrame(frame, priorAlpha, chromaAlpha, v6TestSettings("#23af42"), undefined, false);
		const interior = pixelAt(result.data, 40, 16);
		expect([interior[0], interior[1], interior[2]]).toEqual([subject.r, subject.g, subject.b]);
		expect(result.detachedColorFidelity).toBe(0);
	});

	it("re-adds soft detached halo pixels with continuous alpha where v6 deletes them", () => {
		const settings = v6TestSettings("#23af42");
		const v6 = createV6RgbaFrame(frame, priorAlpha, chromaAlpha, settings, undefined, false);
		const v7 = createV7RgbaFrame(frame, priorAlpha, chromaAlpha, settings, undefined, false);
		const v6Halo = pixelAt(v6.data, 44, 16);
		const v7Halo = pixelAt(v7.data, 44, 16);
		expect(v6Halo[3]).toBe(0);
		expect(v7Halo[3]).toBeGreaterThan(settings.leafAlphaFloor);
		expect(v7Halo[3]).toBeLessThan(200);
	});

	it("decontaminates soft regions without references via the background plate", () => {
		// A wide 50% gray-over-key smoke patch: prior soft, no key-free seeds anywhere.
		const smoke = { b: 180, g: 180, r: 180 };
		const inSmoke = (x: number, y: number): boolean => x >= 12 && x <= 35 && y >= 8 && y <= 23;
		const smokeMix = {
			b: Math.round(smoke.b * 0.5 + key.b * 0.5),
			g: Math.round(smoke.g * 0.5 + key.g * 0.5),
			r: Math.round(smoke.r * 0.5 + key.r * 0.5),
		};
		const smokeFrame = rgbImage(width, height, (x, y) => (inSmoke(x, y) ? [smokeMix.r, smokeMix.g, smokeMix.b] : [key.r, key.g, key.b]));
		const smokePrior = grayImage(width, height, (x, y) => (inSmoke(x, y) ? 128 : 0));
		const smokeChroma = grayImage(width, height, (x, y) => (inSmoke(x, y) ? 255 : 0));
		const result = createV7RgbaFrame(smokeFrame, smokePrior, smokeChroma, v6TestSettings("#23af42"), undefined, false);
		const center = pixelAt(result.data, 24, 16);
		expect(center[3]).toBe(128);
		const srcDominance = keyDominance(smokeMix.r, smokeMix.g, smokeMix.b, key);
		const outDominance = keyDominance(center[0], center[1], center[2], key);
		expect(outDominance).toBeLessThan(srcDominance);
		expect(center[0]).toBeGreaterThan(smokeMix.r);
	});

	it("raises thin-structure alpha toward color-line evidence", () => {
		// A 1px-wide strand of pure subject color whose prior is blurred down to 100.
		const inStrand = (x: number, y: number): boolean => x === 36 && y >= 6 && y <= 25;
		const strandFrame = rgbImage(width, height, (x, y) => {
			if (inSubject(x, y) || inStrand(x, y)) {
				return [subject.r, subject.g, subject.b];
			}
			return [key.r, key.g, key.b];
		});
		const strandPrior = grayImage(width, height, (x, y) => {
			if (inSubject(x, y)) {
				return 255;
			}
			return inStrand(x, y) ? 100 : 0;
		});
		const strandChroma = grayImage(width, height, (x, y) => (inSubject(x, y) || inStrand(x, y) ? 255 : 0));
		const result = createV7RgbaFrame(strandFrame, strandPrior, strandChroma, v6TestSettings("#23af42"), undefined, false);
		expect(pixelAt(result.data, 36, 16)[3]).toBeGreaterThan(200);
	});

	it("rejects mismatched dimensions", () => {
		const tiny = grayImage(4, 4, () => 0);
		expect(() => createV7RgbaFrame(frame, tiny, chromaAlpha, v6TestSettings("#23af42"), undefined, false)).toThrow();
	});
});

describe("buildTruthEdgeMask", () => {
	it("marks the boundary band and soft pixels but not deep interior", () => {
		const width = 16;
		const height = 16;
		const truthAlpha = new Uint8Array(width * height);
		for (let y = 4; y <= 11; y += 1) {
			for (let x = 4; x <= 11; x += 1) {
				truthAlpha[y * width + x] = 255;
			}
		}
		truthAlpha[0] = 128; // isolated soft pixel
		const edge = buildTruthEdgeMask(truthAlpha, width, height);
		expect(edge[4 * width + 4]).toBe(1); // square corner
		expect(edge[8 * width + 8]).toBe(0); // deep interior
		expect(edge[0]).toBe(1); // soft pixel included
	});
});

describe("computeFrameMetrics", () => {
	const width = 16;
	const height = 16;
	const key = parseRgbColor("#23af42");
	const inSquare = (x: number, y: number): boolean => x >= 4 && x <= 11 && y >= 4 && y <= 11;
	const truth = rgbaFrame(width, height, (x, y) => (inSquare(x, y) ? [200, 50, 40, 255] : [0, 0, 0, 0]));
	const emptyDetached = new Uint8Array(width * height);

	it("scores a perfect output as zero error", () => {
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output: Buffer.from(truth),
			truth,
			width,
		});
		expect(metrics.alphaMae).toBe(0);
		expect(metrics.edgeAlphaMae).toBe(0);
		expect(metrics.falseOpaqueRate).toBe(0);
		expect(metrics.falseTransparentRate).toBe(0);
		expect(metrics.fgRgbMae).toBe(0);
		expect(metrics.residualSpill).toBe(0);
		expect(metrics.detachedAlphaRecall).toBeNull();
		expect(metrics.softAlphaMae).toBeNull();
		expect(metrics.temporalAlphaInstability).toBeNull();
	});

	it("counts false transparency when opaque truth is dropped", () => {
		// Drop the right half of the square.
		const output = rgbaFrame(width, height, (x, y) => (inSquare(x, y) && x <= 7 ? [200, 50, 40, 255] : [0, 0, 0, 0]));
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output,
			truth,
			width,
		});
		expect(metrics.falseTransparentRate).toBeCloseTo(0.5, 5);
		expect(metrics.falseOpaqueRate).toBe(0);
	});

	it("counts false opacity when background is rendered solid", () => {
		const output = rgbaFrame(width, height, (x, y) => {
			if (inSquare(x, y)) {
				return [200, 50, 40, 255];
			}
			return x === 0 && y === 0 ? [10, 10, 10, 255] : [0, 0, 0, 0];
		});
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output,
			truth,
			width,
		});
		const transparentTruthPixels = width * height - 64;
		expect(metrics.falseOpaqueRate).toBeCloseTo(1 / transparentTruthPixels, 6);
	});

	it("measures residual green spill against truth dominance", () => {
		// Output adds +60 green to every solid pixel.
		const output = rgbaFrame(width, height, (x, y) => (inSquare(x, y) ? [200, 110, 40, 255] : [0, 0, 0, 0]));
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output,
			truth,
			width,
		});
		// Truth dominance: max(0, 50 - max(200, 40)) = 0. Output: max(0, 110 - 200) = 0 -> still 0.
		expect(metrics.residualSpill).toBe(0);
		// Now make the output genuinely green-dominant.
		const greener = rgbaFrame(width, height, (x, y) => (inSquare(x, y) ? [60, 200, 40, 255] : [0, 0, 0, 0]));
		const greenMetrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output: greener,
			truth,
			width,
		});
		expect(greenMetrics.residualSpill).toBeCloseTo(140 / 255, 4);
	});

	it("detects soft-alpha binarization", () => {
		const softTruth = rgbaFrame(width, height, (x, y) => (inSquare(x, y) ? [200, 50, 40, 128] : [0, 0, 0, 0]));
		const binarized = rgbaFrame(width, height, (x, y) => (inSquare(x, y) ? [200, 50, 40, 255] : [0, 0, 0, 0]));
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output: binarized,
			truth: softTruth,
			width,
		});
		expect(metrics.softBinarizationRate).toBe(1);
		expect(metrics.softAlphaMae).toBeCloseTo(127 / 255, 4);
	});

	it("computes detached recall as truth-weighted overlap", () => {
		const detached = new Uint8Array(width * height);
		for (let y = 4; y <= 11; y += 1) {
			for (let x = 4; x <= 11; x += 1) {
				detached[y * width + x] = 1;
			}
		}
		// Output keeps half the alpha everywhere in the detached region.
		const output = rgbaFrame(width, height, (x, y) => (inSquare(x, y) ? [200, 50, 40, 128] : [0, 0, 0, 0]));
		const metrics = computeFrameMetrics({
			detachedMask: detached,
			height,
			keyColor: key,
			output,
			truth,
			width,
		});
		expect(metrics.detachedAlphaRecall).toBeCloseTo(128 / 255, 4);
		expect(metrics.detachedRgbMae).toBe(0);
	});

	it("measures temporal instability as output change unexplained by truth motion", () => {
		const stableTruthAlpha = new Uint8Array(width * height).fill(255);
		const previousOutputAlpha = new Uint8Array(width * height).fill(255);
		const flicker = rgbaFrame(width, height, () => [200, 50, 40, 200]);
		const solidTruth = rgbaFrame(width, height, () => [200, 50, 40, 255]);
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output: flicker,
			previousOutputAlpha,
			previousTruthAlpha: stableTruthAlpha,
			truth: solidTruth,
			width,
		});
		expect(metrics.temporalAlphaInstability).toBeCloseTo(55 / 255, 4);
	});

	it("reports prior alpha error when a prior is supplied", () => {
		const prior = new Uint8Array(width * height); // all zero prior
		const metrics = computeFrameMetrics({
			detachedMask: emptyDetached,
			height,
			keyColor: key,
			output: Buffer.from(truth),
			priorAlpha: prior,
			truth,
			width,
		});
		expect(metrics.priorAlphaMae).toBeCloseTo(64 / (width * height), 4);
	});
});

describe("aggregateFrameMetrics", () => {
	function frameWith(overrides: Partial<FrameMetrics>): FrameMetrics {
		const base = {} as Record<MetricName, number | null>;
		for (const name of METRIC_NAMES) {
			base[name] = null;
		}
		return { ...(base as unknown as FrameMetrics), ...overrides };
	}

	it("locates the worst frame respecting metric direction", () => {
		const frames = [
			frameWith({ alphaMae: 0.1, detachedAlphaRecall: 0.9 }),
			frameWith({ alphaMae: 0.5, detachedAlphaRecall: 0.2 }),
			frameWith({ alphaMae: 0.2, detachedAlphaRecall: 0.7 }),
		];
		const aggregates = aggregateFrameMetrics(frames);
		expect(aggregates.alphaMae.worstFrame).toBe(2);
		expect(aggregates.alphaMae.worstValue).toBeCloseTo(0.5, 6);
		expect(aggregates.detachedAlphaRecall.worstFrame).toBe(2);
		expect(aggregates.detachedAlphaRecall.worstValue).toBeCloseTo(0.2, 6);
	});

	it("excludes null frames and reports zero coverage when never defined", () => {
		const frames = [
			frameWith({ alphaMae: 0.1 }),
			frameWith({}),
			frameWith({ alphaMae: 0.3 }),
		];
		const aggregates = aggregateFrameMetrics(frames);
		expect(aggregates.alphaMae.frames).toBe(2);
		expect(aggregates.alphaMae.mean).toBeCloseTo(0.2, 6);
		expect(aggregates.softAlphaMae.frames).toBe(0);
		expect(aggregates.softAlphaMae.worstFrame).toBe(0);
	});
});

describe("baseline comparison", () => {
	function aggregate(mean: number, direction: MetricAggregate["direction"], worstValue = mean): MetricAggregate {
		return {
			direction,
			frames: 10,
			max: Math.max(mean, worstValue),
			mean,
			min: Math.min(mean, worstValue),
			worstFrame: 2,
			worstValue,
		};
	}

	function scenarioWith(
		alphaMae: number,
		recall: number,
		alphaWorst = alphaMae,
		recallWorst = recall,
		id = "gt-test",
		extraMetrics: Partial<Record<MetricName, MetricAggregate>> = {},
	): ScenarioAggregates {
		const aggregates = {} as Record<MetricName, MetricAggregate>;
		for (const name of METRIC_NAMES) {
			aggregates[name] = { direction: METRIC_DIRECTIONS[name], frames: 0, max: 0, mean: 0, min: 0, worstFrame: 0, worstValue: 0 };
		}
		aggregates.alphaMae = aggregate(alphaMae, "lower-is-better", alphaWorst);
		aggregates.detachedAlphaRecall = aggregate(recall, "higher-is-better", recallWorst);
		for (const [name, metricAggregate] of Object.entries(extraMetrics) as Array<[MetricName, MetricAggregate]>) {
			aggregates[name] = metricAggregate;
		}
		return { aggregates, id };
	}

	const baseline: BaselineFile = {
		generatedAt: "2026-06-11T00:00:00.000Z",
		scenarios: {
			"gt-test": {
				alphaMae: { direction: "lower-is-better", mean: 0.05, meanTolerance: 0.01, worstTolerance: 0.02, worstValue: 0.1 },
				detachedAlphaRecall: { direction: "higher-is-better", mean: 0.4, meanTolerance: 0.05, worstTolerance: 0.05, worstValue: 0.3 },
			},
		},
		schemaVersion: 1,
	};

	it("passes when current values stay inside tolerance", () => {
		const result = compareReportToBaseline([scenarioWith(0.055, 0.38, 0.11, 0.28)], baseline);
		expect(result.failures).toBe(0);
		expect(result.rows.every((row) => row.status === "pass")).toBe(true);
	});

	it("fails when a lower-is-better metric regresses beyond tolerance", () => {
		const result = compareReportToBaseline([scenarioWith(0.07, 0.4)], baseline);
		const row = result.rows.find((entry) => entry.metric === "alphaMae");
		expect(row?.status).toBe("fail");
		expect(result.failures).toBe(1);
	});

	it("fails when a lower-is-better worst frame regresses beyond tolerance even if the mean passes", () => {
		const result = compareReportToBaseline([scenarioWith(0.05, 0.4, 0.13, 0.3)], baseline);
		const row = result.rows.find((entry) => entry.metric === "alphaMae");
		expect(row?.status).toBe("fail");
		expect(row?.currentWorstFrame).toBe(2);
		expect(result.failures).toBe(1);
	});

	it("fails when a higher-is-better metric drops beyond tolerance", () => {
		const result = compareReportToBaseline([scenarioWith(0.05, 0.3)], baseline);
		const row = result.rows.find((entry) => entry.metric === "detachedAlphaRecall");
		expect(row?.status).toBe("fail");
		expect(result.failures).toBe(1);
	});

	it("marks improvements without failing", () => {
		const result = compareReportToBaseline([scenarioWith(0.01, 0.6)], baseline);
		expect(result.failures).toBe(0);
		expect(result.rows.filter((row) => row.status === "improved")).toHaveLength(2);
	});

	it("treats a missing scenario as failure", () => {
		const result = compareReportToBaseline([], baseline);
		expect(result.failures).toBe(2);
		expect(result.rows.every((row) => row.status === "missing")).toBe(true);
	});

	it("applies an absolute floor and relative component to default tolerances", () => {
		expect(defaultTolerance(0.0001)).toBe(0.005);
		expect(defaultTolerance(0.2)).toBeCloseTo(0.03, 6);
	});

	it("skips never-defined metrics when building a baseline", () => {
		const scenario = scenarioWith(0.05, 0.4);
		const file = buildBaseline([scenario], "2026-06-11T00:00:00.000Z", { ffmpeg: "test" });
		const metrics = file.scenarios["gt-test"];
		expect(Object.keys(metrics).sort()).toEqual(["alphaMae", "detachedAlphaRecall"]);
		expect(metrics.alphaMae.mean).toBeCloseTo(0.05, 6);
		expect(metrics.alphaMae.worstValue).toBeCloseTo(0.05, 6);
	});

	it("fails when the report includes a scenario not in the baseline", () => {
		const known = scenarioWith(0.05, 0.4);
		const extra = scenarioWith(0.05, 0.4, undefined, undefined, "gt-new");
		const result = compareReportToBaseline([known, extra], baseline);
		const row = result.rows.find((entry) => entry.scenario === "gt-new" && entry.metric === "(scenario)");
		expect(row?.status).toBe("unbaselined");
		expect(result.failures).toBe(1);
	});

	it("fails when the report has a metric with frames but no baseline entry", () => {
		const scenario = scenarioWith(0.05, 0.4, undefined, undefined, "gt-test", {
			edgeAlphaMae: aggregate(0.2, "lower-is-better"),
		});
		const scopedBaseline: BaselineFile = {
			...baseline,
			scenarios: { "gt-test": baseline.scenarios["gt-test"] },
		};
		const result = compareReportToBaseline([scenario], scopedBaseline);
		const row = result.rows.find((entry) => entry.metric === "edgeAlphaMae");
		expect(row?.status).toBe("unbaselined-metric");
		expect(result.failures).toBe(1);
	});

	it("allows unbaselined rows when allowUnbaselined is set", () => {
		const known = scenarioWith(0.05, 0.4);
		const extra = scenarioWith(0.05, 0.4, undefined, undefined, "gt-new");
		const result = compareReportToBaseline([known, extra], baseline, { allowUnbaselined: true });
		expect(result.failures).toBe(0);
		expect(result.unbaselinedWarnings).toBe(1);
		expect(result.rows.find((entry) => entry.scenario === "gt-new")?.status).toBe("pass");
	});
});

describe("eval report compare guards", () => {
	it("rejects partial reports without --scenario", () => {
		expect(() =>
			assertComparableEvalReport(
				{ includedScenarioIds: ["gt-sparks"], runScope: "partial", scenarios: [{ id: "gt-sparks" }] },
				undefined,
				CANONICAL_SCENARIO_IDS,
			),
		).toThrow(/partial/i);
	});

	it("allows partial reports when --scenario matches", () => {
		expect(() =>
			assertComparableEvalReport(
				{ includedScenarioIds: ["gt-sparks"], runScope: "partial", scenarios: [{ id: "gt-sparks" }] },
				"gt-sparks",
				CANONICAL_SCENARIO_IDS,
			),
		).not.toThrow();
	});

	it("rejects full reports missing canonical scenarios", () => {
		expect(() =>
			assertComparableEvalReport(
				{ includedScenarioIds: ["gt-sparks"], runScope: "full", scenarios: [{ id: "gt-sparks" }] },
				undefined,
				CANONICAL_SCENARIO_IDS,
			),
		).toThrow(/missing canonical/i);
	});

	it("selectScenariosForCompare filters to one scenario", () => {
		const scenarios = [
			{ aggregates: {} as ScenarioAggregates["aggregates"], id: "gt-sparks" },
			{ aggregates: {} as ScenarioAggregates["aggregates"], id: "gt-smoke" },
		];
		expect(selectScenariosForCompare(scenarios, "gt-sparks")).toHaveLength(1);
		expect(selectScenariosForCompare(scenarios, "gt-sparks")[0]?.id).toBe("gt-sparks");
	});
});

describe("synthetic truth scenarios", () => {
	const options = { frameCount: 8, height: 90, width: 160 };

	it("is deterministic across constructions", () => {
		const first = createScenarios(options);
		const second = createScenarios(options);
		for (let index = 0; index < first.length; index += 1) {
			const a = first[index].generateFrame(5);
			const b = second[index].generateFrame(5);
			expect(Buffer.compare(a.rgba, b.rgba)).toBe(0);
			expect(Buffer.compare(Buffer.from(a.detachedMask), Buffer.from(b.detachedMask))).toBe(0);
		}
	});

	it("provides sparks with genuinely detached pixels and zeroed RGB under zero alpha", () => {
		const sparks = createScenarios(options).find((scenario) => scenario.id === "gt-sparks");
		expect(sparks).toBeDefined();
		let detachedTotal = 0;
		for (let index = 0; index < options.frameCount; index += 1) {
			const frame = sparks!.generateFrame(index);
			for (let pixel = 0; pixel < options.width * options.height; pixel += 1) {
				detachedTotal += frame.detachedMask[pixel];
				const offset = pixel * 4;
				if (frame.rgba[offset + 3] === 0) {
					expect(frame.rgba[offset]).toBe(0);
					expect(frame.rgba[offset + 1]).toBe(0);
					expect(frame.rgba[offset + 2]).toBe(0);
				}
			}
		}
		expect(detachedTotal).toBeGreaterThan(0);
	});

	it("provides smoke with a substantial soft-alpha fraction", () => {
		const smoke = createScenarios(options).find((scenario) => scenario.id === "gt-smoke");
		const frame = smoke!.generateFrame(4);
		let soft = 0;
		let visible = 0;
		for (let pixel = 0; pixel < options.width * options.height; pixel += 1) {
			const alpha = frame.rgba[pixel * 4 + 3];
			if (alpha > 0) {
				visible += 1;
				if (alpha >= 16 && alpha <= 239) {
					soft += 1;
				}
			}
		}
		expect(visible).toBeGreaterThan(0);
		expect(soft / visible).toBeGreaterThan(0.5);
	});

	it("provides tassels with thin disconnected strands below the band", () => {
		const tassels = createScenarios(options).find((scenario) => scenario.id === "gt-tassels");
		const frame = tassels!.generateFrame(3);
		// Count distinct visible runs along a horizontal scanline in the strand region
		// (just below the band bottom at 0.34 * height; strands reach ~0.54+ of height).
		const y = Math.floor(options.height * 0.45);
		let runs = 0;
		let inRun = false;
		for (let x = 0; x < options.width; x += 1) {
			const visible = frame.rgba[(y * options.width + x) * 4 + 3] > 64;
			if (visible && !inRun) {
				runs += 1;
			}
			inRun = visible;
		}
		expect(runs).toBeGreaterThan(3);
	});

	it("composites straight alpha over the plate", () => {
		const width = 2;
		const height = 1;
		const truth = Buffer.from([255, 0, 0, 255, 255, 0, 0, 128]);
		const plate = Buffer.from([0, 200, 0, 0, 200, 0]);
		const composite = compositeOverPlate(truth, plate, width, height);
		expect([composite[0], composite[1], composite[2]]).toEqual([255, 0, 0]);
		expect(composite[3]).toBe(Math.round(255 * (128 / 255)));
		expect(composite[4]).toBe(Math.round(200 * (1 - 128 / 255)));
	});

	it("uses the default 48-frame 640x360 configuration", () => {
		expect(DEFAULT_SCENARIO_OPTIONS).toEqual({ frameCount: 48, height: 360, width: 640 });
	});
});
