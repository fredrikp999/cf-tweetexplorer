// SVG to PNG in the Worker, for the pictures a shared link shows (src/site/shareCard.ts). resvg in WebAssembly, with the site's own face bundled (two weights, latin only,
// SIL Open Font License: fonts/OFL.txt): the renderer reads no system fonts, so text looks the same everywhere. The module is started once per isolate, on the first picture.
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import semibold from './fonts/BricolageGrotesque-SemiBold.ttf';
import extrabold from './fonts/BricolageGrotesque-ExtraBold.ttf';

let ready: Promise<void> | null = null;
const fonts = [new Uint8Array(semibold), new Uint8Array(extrabold)];

/** The SVG as a PNG `width` pixels wide. `family` is the font the SVG asks for. */
export async function svgToPng(svg: string, width: number, family: string): Promise<Uint8Array> {
  ready ??= initWasm(wasm).catch((err) => { ready = null; throw err; });
  await ready;
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: family, sansSerifFamily: family } });
  try { const img = r.render(); try { return img.asPng(); } finally { img.free(); } } finally { r.free(); }
}
