# Validating this sprite pack

The generator checks all twenty sheets for 128x128 dimensions, binary alpha,
sixteen nonempty frames, and unexpected top/side frame-edge pixels.
`validation.json` records all 320 frame bounds. Contact sheets and the
animated preview are for visual checks; automated dimensions do not prove
that every combination will fit a modified body.

Before handoff, compare source hashes against `manifest.json`, confirm all
twenty generated files are distinct, and inspect walking hands, hips, hems,
and ankles on both supplied bodies. Open `preview.html` locally and confirm
its loaded status, controls, and pixel-sharp rendering. In-game import,
texture settings, and origin alignment require a final GameMaker check.
