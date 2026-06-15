/**
 * 2AFC aliveness harness (§9.3). Each trial shows the SAME control twice — once
 * living (Celstate runtime motion) and once static (plain RN, no motion) — in a
 * randomised left/right order. The viewer taps the one that feels "more alive /
 * more premium". We tally how often the living build is preferred.
 *
 * Pass criterion (F-gate): living preferred at p < 0.05 (binomial vs 50%) with
 * effect >= 70/30 over N >= 30 trials, and no rise in self-reported discomfort.
 *
 * This file is also the on-device measurement vehicle for the C-gate (fps /
 * memory / right-size): render it on real iOS + Android devices and profile.
 *
 * Static controls are deliberately plain — the honest baseline the vision must beat.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CelstateLivingButton } from '../celstate-living-button/CelstateLivingButton';
import { CelstateLivingSlider } from '../celstate-living-slider/CelstateLivingSlider';

type Primitive = 'button' | 'slider';
type Choice = 'living' | 'static';

const PALETTE = {
  accent: '#C2410C',
  onAccent: '#FFFFFF',
  surface: '#FAF8F4',
  border: '#E2DED6',
  text: '#1C1917',
  bg: '#F5F3ED',
};

// A plain, unanimated control — the static baseline for the forced choice.
function StaticButton({ label }: { label: string }) {
  return (
    <View style={styles.staticButton}>
      <Text style={styles.staticButtonLabel}>{label}</Text>
    </View>
  );
}

function StaticSlider({ value }: { value: number }) {
  return (
    <View style={styles.staticSliderArea}>
      <View style={styles.staticRail} />
      <View style={[styles.staticFill, { width: `${value * 100}%` }]} />
      <View style={[styles.staticThumb, { left: `${value * 100}%` }]} />
    </View>
  );
}

function LivingCell({ primitive, sliderValue, onSlide }: {
  primitive: Primitive;
  sliderValue: number;
  onSlide: (v: number) => void;
}) {
  return primitive === 'button' ? (
    <CelstateLivingButton label="Generate" onPress={() => {}} theme={PALETTE} />
  ) : (
    <CelstateLivingSlider value={sliderValue} onValueChange={onSlide} theme={PALETTE} />
  );
}

function StaticCell({ primitive, sliderValue }: { primitive: Primitive; sliderValue: number }) {
  return primitive === 'button' ? <StaticButton label="Generate" /> : <StaticSlider value={sliderValue} />;
}

export function LivingVsStaticScreen() {
  const [trials, setTrials] = useState<{ primitive: Primitive; choice: Choice }[]>([]);
  const [sliderValue, setSliderValue] = useState(0.5);

  // Deterministic per-trial layout: living goes left on even trials.
  const trialIndex = trials.length;
  const primitive: Primitive = trialIndex % 2 === 0 ? 'button' : 'slider';
  const livingOnLeft = useMemo(() => trialIndex % 2 === 0, [trialIndex]);

  const record = (side: 'left' | 'right') => {
    const choice: Choice = (side === 'left') === livingOnLeft ? 'living' : 'static';
    setTrials((prev) => [...prev, { primitive, choice }]);
  };

  const livingPreferred = trials.filter((t) => t.choice === 'living').length;
  const rate = trials.length ? livingPreferred / trials.length : 0;

  const leftIsLiving = livingOnLeft;

  return (
    <ScrollView style={{ backgroundColor: PALETTE.bg }} contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Which feels more alive?</Text>
      <Text style={styles.sub}>Tap the {primitive} that feels more alive / more premium.</Text>

      <View style={styles.row}>
        <Pressable style={styles.cell} onPress={() => record('left')}>
          {leftIsLiving ? (
            <LivingCell primitive={primitive} sliderValue={sliderValue} onSlide={setSliderValue} />
          ) : (
            <StaticCell primitive={primitive} sliderValue={sliderValue} />
          )}
          <Text style={styles.cellTag}>A</Text>
        </Pressable>

        <Pressable style={styles.cell} onPress={() => record('right')}>
          {leftIsLiving ? (
            <StaticCell primitive={primitive} sliderValue={sliderValue} />
          ) : (
            <LivingCell primitive={primitive} sliderValue={sliderValue} onSlide={setSliderValue} />
          )}
          <Text style={styles.cellTag}>B</Text>
        </Pressable>
      </View>

      <View style={styles.scoreCard}>
        <Text style={styles.scoreLine}>Trials: {trials.length}</Text>
        <Text style={styles.scoreLine}>
          Living preferred: {livingPreferred} ({Math.round(rate * 100)}%)
        </Text>
        <Text style={styles.scoreHint}>
          F-gate target: ≥ 70% over ≥ 30 trials, p {'<'} 0.05. Export `trials` for the binomial test
          (packages/living-ui-runtime `binomialRightTailProbability`).
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingVertical: 56, gap: 24 },
  h1: { fontSize: 28, fontWeight: '600', color: PALETTE.text },
  sub: { fontSize: 15, color: '#78716C' },
  row: { flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 140,
    paddingVertical: 20,
    backgroundColor: PALETTE.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PALETTE.border,
  },
  cellTag: { fontSize: 12, color: '#78716C', letterSpacing: 1 },
  scoreCard: {
    padding: 16,
    backgroundColor: PALETTE.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PALETTE.border,
    gap: 6,
  },
  scoreLine: { fontSize: 15, color: PALETTE.text },
  scoreHint: { fontSize: 12, color: '#78716C', marginTop: 4 },
  staticButton: {
    minWidth: 180,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: PALETTE.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  staticButtonLabel: { color: PALETTE.onAccent, fontSize: 16, fontWeight: '600' },
  staticSliderArea: { width: '100%', height: 28, justifyContent: 'center' },
  staticRail: { height: 6, borderRadius: 3, backgroundColor: PALETTE.border, width: '100%' },
  staticFill: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: PALETTE.accent },
  staticThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: -14,
    backgroundColor: PALETTE.surface,
    borderWidth: 2,
    borderColor: PALETTE.accent,
  },
});
