import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertLivingControlManifest,
  type LivingControlManifest,
} from "../../packages/living-ui-runtime/src/index.js";

interface QaReport {
  readonly component: string;
  readonly primitive: string;
  readonly machineVerified: { readonly gates: Record<string, { readonly status: string }> };
  readonly pendingHumanOrDevice: Record<string, { readonly status: string }>;
}

function readJson<T>(relativePath: string): T {
  const url = new URL(`../../bundles/${relativePath}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

const BUNDLES = [
  { dir: "celstate-living-button", primitive: "button", component: "CelstateLivingButton" },
  { dir: "celstate-living-slider", primitive: "slider", component: "CelstateLivingSlider" },
] as const;

describe("agent-installable bundle contract (§5.1)", () => {
  for (const bundle of BUNDLES) {
    describe(bundle.dir, () => {
      const manifest = readJson<LivingControlManifest>(`${bundle.dir}/celstate.manifest.json`);
      const qa = readJson<QaReport>(`${bundle.dir}/qa-report.json`);

      it("passes the typed manifest contract", () => {
        expect(() => assertLivingControlManifest(manifest)).not.toThrow();
        expect(manifest.primitive).toBe(bundle.primitive);
        expect(manifest.component).toBe(bundle.component);
      });

      it("is runtime-owned, never a sprite sheet (§12 durable lesson)", () => {
        expect(["procedural_still", "rigged_deformation"]).toContain(manifest.motionPath);
      });

      it("reports every machine-verified gate as passing", () => {
        const gates = Object.entries(qa.machineVerified.gates);
        expect(gates.length).toBeGreaterThan(0);
        for (const [name, gate] of gates) {
          expect(gate.status, `${bundle.dir} gate ${name}`).toBe("pass");
        }
      });

      it("honestly tracks the human/device gates as pending", () => {
        expect(qa.component).toBe(bundle.component);
        expect(qa.pendingHumanOrDevice.aliveness_2afc?.status).toBe("pending");
        expect(qa.pendingHumanOrDevice.installability_blank_expo_app?.status).toBe("pending");
      });
    });
  }
});
