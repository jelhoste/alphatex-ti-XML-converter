// converter-t2gp.mjs — AlphaTex -> Guitar Pro 7+ (.gp), browser build.
// Both pieces are native AlphaTab features (AlphaTex parser + Gp7Exporter);
// this file is only the glue between them.
import * as alphaTab from './vendor/alphaTab.mjs';

export function convertAlphaTexToGp(alphaTexSource) {
    const settings = new alphaTab.Settings();
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(alphaTexSource, settings);
    const exporter = new alphaTab.exporter.Gp7Exporter();
    return exporter.export(score, settings); // Uint8Array
}
