// ---------------------------------------------------------------------------
// Presets (Phase 6) — one click sets Style + Capture + Output to a coherent
// combo for a common target. Each `settings` object is a partial of the store's
// SETTINGS_KEYS; applying it goes through store.applySettings() (unknown keys
// ignored) followed by syncCaptureFromStore() to nudge the imperative rig.
// ---------------------------------------------------------------------------

export const PRESETS = [
  {
    id: '8dir-512-toon',
    name: '8-dir 512 toon',
    desc: '8 turnaround directions, toon + outline, 512px cells, one sheet per direction.',
    settings: {
      captureAngleCount: 8,
      captureElevation: 20,
      materialMode: 'toon',
      toonSteps: 3,
      outlineEnabled: true,
      outlineWidth: 0.004,
      outCellSize: 512,
      outFrameCount: 12,
      outColumns: 6,
      outScope: 'all',
      outAngleLayout: 'separate',
      outWantSheet: true,
      outWantFrames: false,
    },
  },
  {
    id: 'iso-8dir',
    name: 'Isometric 8-dir',
    desc: '8 directions tilted 30° for top-down/iso games, toon + outline, 512px.',
    settings: {
      captureAngleCount: 8,
      captureElevation: 30,
      materialMode: 'toon',
      toonSteps: 3,
      outlineEnabled: true,
      outlineWidth: 0.004,
      outCellSize: 512,
      outScope: 'all',
      outAngleLayout: 'separate',
      outWantSheet: true,
    },
  },
  {
    id: '4dir-256-flat',
    name: '4-dir 256 flat',
    desc: 'Compact 4-way, flat/unlit (no outline), 256px cells stacked as rows.',
    settings: {
      captureAngleCount: 4,
      captureElevation: 15,
      materialMode: 'unlit',
      outlineEnabled: false,
      outCellSize: 256,
      outColumns: 8,
      outScope: 'all',
      outAngleLayout: 'stacked',
      outWantSheet: true,
    },
  },
  {
    id: 'single-512-toon',
    name: 'Side-scroller',
    desc: 'One locked angle, toon + outline, 512px — for a 2D side-scroller.',
    settings: {
      captureAngleCount: 1,
      captureElevation: 0,
      materialMode: 'toon',
      toonSteps: 3,
      outlineEnabled: true,
      outlineWidth: 0.004,
      outCellSize: 512,
      outScope: 'current',
      outWantSheet: true,
    },
  },
]
