// converter-x2t.mjs — MusicXML -> AlphaTex, browser build.
//
// Uses AlphaTab's own official importer (auto-detects MusicXML) and its
// own official AlphaTexExporter. This file is only the glue between them;
// no custom serialization logic was needed for this direction.
import * as alphaTab from './vendor/alphaTab.mjs';

export function convertMusicXmlToAlphaTex(musicXmlBytesOrString) {
    const settings = new alphaTab.Settings();
    const bytes = typeof musicXmlBytesOrString === 'string'
        ? new TextEncoder().encode(musicXmlBytesOrString)
        : musicXmlBytesOrString;
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    const exporter = new alphaTab.exporter.AlphaTexExporter();
    return exporter.exportToString(score, settings);
}
