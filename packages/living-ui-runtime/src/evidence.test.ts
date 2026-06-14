import { describe, expect, it } from "vitest";
import {
  binomialRightTailProbability,
  evaluateAlivenessGate,
  evaluateConsumptionGate,
  evaluateGenerationGate,
  evaluateLivingUiMvp,
  type LivingUiAssetClass,
  type LivingUiAssetMvpEvidence,
  type LivingUiGateCalibration,
  type LivingUiPlatformConsumptionEvidence,
} from "./index.js";

const calibration = {
  boilMax: 0.3,
  calibratedAssetIds: ["button-bush", "slider-rail", "firefly-field"],
  loopSeamMax: 0.2,
  minFramesByAssetClass: {
    ambient_background: 8,
    button_overlay: 8,
    interactive_control: 8,
    loader_feedback: 8,
    small_accent: 8,
  },
} satisfies LivingUiGateCalibration;

function platformEvidence(platform: "ios" | "android"): LivingUiPlatformConsumptionEvidence {
  return {
    fpsByInstanceCount: {
      1: 60,
      10: 60,
      50: 59,
    },
    interactivityLatencyFrames: 1,
    loopSeamless: true,
    memoryPassAt50: true,
    platform,
    rightSizePassByDensity: {
      1: true,
      2: true,
      3: true,
    },
  };
}

function assetEvidence(assetClass: LivingUiAssetClass): LivingUiAssetMvpEvidence {
  const assetId = `${assetClass}-asset`;
  return {
    assetClass,
    assetId,
    consumption: {
      platforms: [platformEvidence("ios"), platformEvidence("android")],
    },
    generation: {
      assetClass,
      assetId,
      boilScore: 0.2,
      crispCellPxRecorded: true,
      founderReviewScore: 4,
      frameCount: 12,
      loopSeamScore: 0.1,
      maxWhiteBlackDriftPx: 1,
      requestedImageSizeHonored: true,
    },
    rendersThroughRuntimeComponent: true,
  };
}

describe("living UI MVP evidence gates", () => {
  it("passes the MVP bar with four passing classes, calibrated gates, and significant 2AFC", () => {
    const evaluation = evaluateLivingUiMvp({
      aliveness: {
        discomfortNoWorse: true,
        distractionNoWorse: true,
        livingPreferredCount: 21,
        trialCount: 30,
      },
      assets: [
        assetEvidence("small_accent"),
        assetEvidence("interactive_control"),
        assetEvidence("button_overlay"),
        assetEvidence("ambient_background"),
      ],
      calibration,
    });

    expect(evaluation.pass).toBe(true);
    expect(evaluation.coverage.passedClassCount).toBe(4);
    expect(evaluation.aliveness.preferenceRate).toBe(0.7);
    expect(evaluation.aliveness.pValue).toBeLessThan(0.05);
  });

  it("rejects generated evidence that misses the calibrated G-gate", () => {
    const evaluation = evaluateGenerationGate({
      assetClass: "button_overlay",
      assetId: "button-bush",
      boilScore: 0.31,
      crispCellPxRecorded: false,
      founderReviewScore: 3.9,
      frameCount: 7,
      loopSeamScore: 0.21,
      maxWhiteBlackDriftPx: 1.1,
      requestedImageSizeHonored: false,
    }, calibration);

    expect(evaluation.pass).toBe(false);
    expect(evaluation.reasonCodes).toEqual([
      "founder_review_below_4",
      "registration_drift_above_1_px",
      "boil_above_calibrated_max",
      "loop_seam_above_calibrated_max",
      "frame_count_below_min",
      "requested_image_size_not_honored",
      "crisp_cell_px_not_recorded",
    ]);
  });

  it("requires both physical platforms and every C-gate density/load point", () => {
    const evaluation = evaluateConsumptionGate({
      platforms: [{
        ...platformEvidence("ios"),
        fpsByInstanceCount: {
          1: 60,
          10: 57,
          50: 60,
        },
        rightSizePassByDensity: {
          1: true,
          2: true,
          3: false,
        },
      }],
    });

    expect(evaluation.pass).toBe(false);
    expect(evaluation.reasonCodes).toEqual([
      "ios_fps_below_58_at_10",
      "ios_right_size_failed_at_density_3",
      "missing_android_device_evidence",
    ]);
  });

  it("keeps the aliveness metric tied to the specified 70/30 significant result", () => {
    expect(binomialRightTailProbability(21, 30)).toBeLessThan(0.05);
    expect(evaluateAlivenessGate({
      discomfortNoWorse: true,
      distractionNoWorse: true,
      livingPreferredCount: 20,
      trialCount: 30,
    })).toMatchObject({
      pass: false,
      reasonCodes: ["aliveness_effect_below_70_30"],
    });
  });
});
