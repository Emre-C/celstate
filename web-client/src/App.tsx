import { useState } from 'react'
import { CelstateContainer } from './components/CelstateContainer'
import { CelstateDecoration } from './components/CelstateDecoration'
import { ExperimentToggle } from './components/ExperimentToggle'

// Experiment 1.1: Native-Size Asset Generation
// Each asset was generated at its target size with render_size_hint
const EXPERIMENT_1_1_ASSETS = {
  // Small Tag (80px hint → 64px actual)
  small_tag: '2d98441c-b442-41b4-97a1-e5dbfbcd89c6',
  // Medium Button (160px hint → 130px actual)
  medium_button: '5c544638-74f0-46f3-a1fd-6f4f29b3d3dd',
  // Large Panel (300px hint → 185px actual)
  large_panel: '7d481fb7-6870-4f5c-a48e-7c4025fd5faf',
  // Decoration (vine)
  vine: '10b1f877-377a-4348-b409-65c64e5bbca4',
};

function App() {
  const [mode, setMode] = useState<'native' | 'celstate'>('celstate');

  return (
    <div className="w-[430px] h-[932px] bg-white text-gray-900 shadow-2xl rounded-[40px] overflow-hidden flex flex-col relative border-8 border-gray-900 mx-auto mt-10 shrink-0">
      {/* Device Notch / Status Bar Area */}
      <div className="h-12 bg-gray-100 flex items-center justify-center border-b border-gray-200 shrink-0">
        <span className="text-xs font-bold text-gray-400">9:41</span>
      </div>

      {/* Header */}
      <header className="px-6 py-4 flex flex-col gap-4 bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent">
            Experiment 1.1
          </h1>
          <div className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-full border border-gray-100">
            <span className="text-xs">🎨</span>
          </div>
        </div>

        {/* The Toggle */}
        <div className="flex justify-center">
          <ExperimentToggle mode={mode} onToggle={setMode} />
        </div>
      </header>

      {/* Scrollable Body */}
      <main className="flex-1 overflow-y-auto p-6 space-y-8 relative">
        {/* Decorative Vine Overlay */}
        {mode === 'celstate' && (
          <CelstateDecoration
            jobId={EXPERIMENT_1_1_ASSETS.vine}
            anchor="top-right"
            offset={{ x: 0, y: 0 }}
            style={{ zIndex: 50 }}
          />
        )}

        {/* Experiment Title */}
        <div className="text-center space-y-2">
          <h2 className="text-lg font-bold text-gray-700">Native-Size Asset Verification</h2>
          <p className="text-xs text-gray-500 max-w-xs mx-auto">
            Each asset was generated at its target size using <code className="bg-gray-100 px-1 rounded">render_size_hint</code>.
            No stretching, no 9-slice. Just native rendering.
          </p>
        </div>

        {/* Asset Verification Grid */}
        <section className="space-y-6">

          {/* Small Tag (80px) */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-600">Small Tag</span>
              <span className="text-[10px] text-gray-400 font-mono">Native: 64x32</span>
            </div>
            <div className="flex justify-center">
              <div style={{ width: 64, height: 32 }} className="flex items-center justify-center">
                {mode === 'native' ? (
                  <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">
                    Tag
                  </div>
                ) : (
                  <CelstateContainer jobId={EXPERIMENT_1_1_ASSETS.small_tag} initialWidth={64}>
                    <span className="text-[10px] font-bold text-amber-900 px-2">New</span>
                  </CelstateContainer>
                )}
              </div>
            </div>
          </div>

          {/* Medium Button (160px) */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-600">Medium Button</span>
              <span className="text-[10px] text-gray-400 font-mono">Native: 130x70</span>
            </div>
            <div className="flex justify-center">
              <div style={{ width: 130, height: 70 }} className="flex items-center justify-center">
                {mode === 'native' ? (
                  <div className="w-full h-full bg-gray-200 rounded-lg flex items-center justify-center text-sm font-bold text-gray-500">
                    Button
                  </div>
                ) : (
                  <CelstateContainer jobId={EXPERIMENT_1_1_ASSETS.medium_button} initialWidth={130}>
                    <span className="text-sm font-bold text-amber-900 px-4">Standard Button</span>
                  </CelstateContainer>
                )}
              </div>
            </div>
          </div>

          {/* Large Panel (300px) */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-600">Large Panel</span>
              <span className="text-[10px] text-gray-400 font-mono">Native: 185x106</span>
            </div>
            <div className="flex justify-center">
              <div style={{ width: 185, height: 106 }} className="flex items-center justify-center">
                {mode === 'native' ? (
                  <div className="w-full h-full bg-gray-200 rounded-xl flex items-center justify-center text-lg font-bold text-gray-500">
                    Hero Card
                  </div>
                ) : (
                  <CelstateContainer jobId={EXPERIMENT_1_1_ASSETS.large_panel} initialWidth={185}>
                    <div className="flex flex-col items-center justify-center h-full text-amber-900 px-6">
                      <span className="text-xl">✦</span>
                      <span className="text-lg font-bold">Hero Card</span>
                    </div>
                  </CelstateContainer>
                )}
              </div>
            </div>
          </div>

        </section>

        {/* Verification Checklist */}
        <section className="bg-emerald-50 rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-emerald-700">✓ Verification Checklist</h3>
          <ul className="text-xs text-emerald-600 space-y-1">
            <li>☐ Toggle to Celstate mode - assets render correctly</li>
            <li>☐ No blurriness or stretching artifacts</li>
            <li>☐ Text/content stays within safe zones</li>
            <li>☐ Assets look cohesive (same Ghibli style)</li>
            <li>☐ Vine decoration drapes naturally, doesn't block interaction</li>
          </ul>
        </section>

      </main>

      {/* Home Bar Indicator */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-32 h-1 bg-gray-900 rounded-full opacity-20 pointer-events-none" style={{ zIndex: 60 }}></div>
    </div>
  )
}

export default App
