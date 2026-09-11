// converter-gp2t.mjs — Guitar Pro -> AlphaTex, browser build.
// Both pieces are native AlphaTab features (format auto-detecting
// importer + AlphaTexExporter); this file is only the glue between them.
import * as alphaTab from './vendor/alphaTab.mjs';

export function convertGpToAlphaTex(gpBytes) {
    const settings = new alphaTab.Settings();
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(gpBytes, settings);
    const exporter = new alphaTab.exporter.AlphaTexExporter();
    return exporter.exportToString(score, settings);
}
