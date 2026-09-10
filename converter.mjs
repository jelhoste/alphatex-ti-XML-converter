// alphatex-to-musicxml.mjs
//
// Converts AlphaTex source into a MusicXML 4.0 (score-partwise) document.
//
// Approach: uses the REAL AlphaTab library (@coderline/alphatab) to parse
// AlphaTex into its official `Score` data model (the same model AlphaTab
// uses internally for rendering and for its own Guitar Pro exporter), then
// walks that model and serializes it into MusicXML using only native
// MusicXML constructs. AlphaTab-specific concepts that have no native
// MusicXML representation (palm-mute, let-ring, rasgueado, golpe, wah-pedal,
// tremolo-picking style, ottava text glyphs, etc.) are intentionally
// skipped. See README.md for the full coverage table.
//
// Usage:
//   node convert.mjs input.alphatex output.xml
//   node convert.mjs input.alphatex            (prints to stdout)

import * as alphaTab from './vendor/alphaTab.mjs';

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { [a, b] = [b, a % b]; }
    return a || 1;
}
function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }

function xmlEscape(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Very small XML builder: lets us push tags without hand-nesting strings.
class XmlWriter {
    constructor() { this.lines = []; this.indent = 0; }
    open(tag, attrs = {}) {
        const a = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`).join('');
        this.lines.push('  '.repeat(this.indent) + `<${tag}${a}>`);
        this.indent++;
        return this;
    }
    close(tag) {
        this.indent--;
        this.lines.push('  '.repeat(this.indent) + `</${tag}>`);
        return this;
    }
    // self-closing or leaf tag with optional text content
    leaf(tag, attrs = {}, text = undefined) {
        const a = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`).join('');
        if (text === undefined) {
            this.lines.push('  '.repeat(this.indent) + `<${tag}${a}/>`);
        } else {
            this.lines.push('  '.repeat(this.indent) + `<${tag}${a}>${xmlEscape(text)}</${tag}>`);
        }
        return this;
    }
    raw(line) { this.lines.push('  '.repeat(this.indent) + line); return this; }
    toString() { return this.lines.join('\n'); }
}

// ---------------------------------------------------------------------
// Music theory helpers
// ---------------------------------------------------------------------

// Pitch spelling tables (index = pitch class 0..11)
const SHARP_SPELLING = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiToPitch(midi, fifths) {
    const table = fifths >= 0 ? SHARP_SPELLING : FLAT_SPELLING;
    const pc = ((midi % 12) + 12) % 12;
    const name = table[pc];
    const step = name[0];
    let alter = 0;
    if (name.includes('#')) alter = 1;
    else if (name.includes('b')) alter = -1;
    const octave = Math.floor(midi / 12) - 1;
    return { step, alter, octave };
}

// AlphaTab Duration enum values are the note-value denominator (1=whole..256)
const DURATION_TYPE = {
    [-4]: 'maxima', // QuadrupleWhole - not standard MusicXML, approximated
    [-2]: 'long',   // DoubleWhole - not standard MusicXML either, approximated
    1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th',
    32: '32nd', 64: '64th', 128: '128th', 256: '256th'
};

// Base divisions-per-quarter-note. 256 safely covers 256th notes with up
// to 2 dots using only integer division values (see README for the math).
const BASE_DIVISIONS = 256;

function computeDivisions(score) {
    let divisions = BASE_DIVISIONS;
    forEachBeat(score, (beat) => {
        if (beat.tupletNumerator > 0 && beat.tupletDenominator > 0 &&
            beat.tupletNumerator !== beat.tupletDenominator) {
            // Need divisions divisible by tupletNumerator (the "actual" count)
            divisions = lcm(divisions, beat.tupletNumerator);
        }
    });
    return divisions;
}

function beatDurationInDivisions(beat, divisions) {
    // base quarters for this note value
    let quarters = 4 / beat.duration;
    // dots: 1 dot -> *1.5, 2 dots -> *1.75 etc.
    let dotFactor = 2 - (1 / Math.pow(2, beat.dots));
    quarters *= dotFactor;
    // tuplet: actual-notes in the time of normal-notes
    if (beat.tupletNumerator > 0 && beat.tupletDenominator > 0 &&
        beat.tupletNumerator !== beat.tupletDenominator) {
        quarters *= beat.tupletDenominator / beat.tupletNumerator;
    }
    return Math.round(quarters * divisions);
}

function forEachBeat(score, fn) {
    for (const track of score.tracks) {
        for (const staff of track.staves) {
            for (const bar of staff.bars) {
                for (const voice of bar.voices) {
                    for (const beat of voice.beats) fn(beat, { track, staff, bar, voice });
                }
            }
        }
    }
}

// String number as used in MusicXML / AlphaTex input (1 = highest pitched
// string). AlphaTab's internal Note.string is numbered the other way
// (1 = lowest pitched string), so we flip it using the tuning length.
function toXmlStringNumber(note, staff) {
    const len = staff.stringTuning.tunings.length;
    return len - note.string + 1;
}

const DYNAMIC_TAGS = new Set([
    'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'pppp', 'ppppp', 'pppppp',
    'ffff', 'fffff', 'ffffff', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz',
    'sffz', 'fz', 'n', 'pf', 'sfzp'
]);

// ---------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------

export function convertAlphaTexToMusicXml(alphaTexSource) {
    const settings = new alphaTab.Settings();
    const score = alphaTab.importer.ScoreLoader.loadAlphaTex(alphaTexSource, settings);
    return scoreToMusicXml(score);
}

function scoreToMusicXml(score) {
    const divisions = computeDivisions(score);
    const w = new XmlWriter();

    w.raw('<?xml version="1.0" encoding="UTF-8"?>');
    w.raw('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
    w.open('score-partwise', { version: '4.0' });

    if (score.title) {
        w.open('work');
        w.leaf('work-title', {}, score.title);
        w.close('work');
    }

    w.open('identification');
    if (score.artist || score.words) {
        if (score.artist) w.leaf('creator', { type: 'composer' }, score.artist);
        if (score.words) w.leaf('creator', { type: 'lyricist' }, score.words);
    }
    w.open('encoding');
    w.leaf('software', {}, 'alphatex-to-musicxml (built on the real AlphaTab parser)');
    w.leaf('encoding-date', {}, new Date().toISOString().slice(0, 10));
    w.close('encoding');
    w.close('identification');

    // --- part-list ---
    w.open('part-list');
    score.tracks.forEach((track, ti) => {
        w.open('score-part', { id: `P${ti + 1}` });
        w.leaf('part-name', {}, track.name || `Track ${ti + 1}`);
        const pi = track.playbackInfo;
        if (pi) {
            w.open('score-instrument', { id: `P${ti + 1}-I1` });
            w.leaf('instrument-name', {}, track.name || `Instrument ${ti + 1}`);
            w.close('score-instrument');
            w.open('midi-instrument', { id: `P${ti + 1}-I1` });
            w.leaf('midi-channel', {}, (pi.primaryChannel ?? 0) + 1);
            w.leaf('midi-program', {}, (pi.program ?? 0) + 1);
            w.leaf('volume', {}, Math.round(((pi.volume ?? 15) / 16) * 100));
            w.close('midi-instrument');
        }
        w.close('score-part');
    });
    w.close('part-list');

    // --- parts ---
    score.tracks.forEach((track, ti) => {
        writePart(w, score, track, ti, divisions);
    });

    w.close('score-partwise');
    return w.toString();
}

function clefToXml(clef) {
    // AlphaTab Clef enum: Neutral, C3, C4, F4, G2
    switch (clef) {
        case alphaTab.model.Clef.G2: return { sign: 'G', line: 2 };
        case alphaTab.model.Clef.F4: return { sign: 'F', line: 4 };
        case alphaTab.model.Clef.C3: return { sign: 'C', line: 3 };
        case alphaTab.model.Clef.C4: return { sign: 'C', line: 4 };
        case alphaTab.model.Clef.Neutral: default: return { sign: 'percussion', line: 2 };
    }
}

function writePart(w, score, track, trackIndex, divisions) {
    w.open('part', { id: `P${trackIndex + 1}` });

    const numStaves = track.staves.length;
    // All staves of a track share the same bar count/measure structure
    const barCount = track.staves[0].bars.length;

    let prevKeyFifths, prevKeyMode, prevTsNum, prevTsDen, prevClef = new Array(numStaves).fill(undefined);
    let attributesWrittenOnce = false;
    // Dynamics only need to be written when they change; track last value
    // written per voice so we don't repeat "f" before every single note.
    const lastDynamicByVoice = new Map();

    for (let barIndex = 0; barIndex < barCount; barIndex++) {
        const masterBar = track.staves[0].bars[barIndex].masterBar;
        w.open('measure', { number: barIndex + 1 });

        // --- <attributes> : divisions / key / time / clef / staff-details ---
        const bar0 = track.staves[0].bars[barIndex];
        const keyFifths = bar0.keySignature;
        const keyMode = bar0.keySignatureType === alphaTab.model.KeySignatureType.Minor ? 'minor' : 'major';
        const tsNum = masterBar.timeSignatureNumerator;
        const tsDen = masterBar.timeSignatureDenominator;
        const clefsNow = track.staves.map(s => s.bars[barIndex].clef);

        const needAttributes = !attributesWrittenOnce ||
            keyFifths !== prevKeyFifths || keyMode !== prevKeyMode ||
            tsNum !== prevTsNum || tsDen !== prevTsDen ||
            clefsNow.some((c, i) => c !== prevClef[i]);

        if (needAttributes) {
            w.open('attributes');
            if (!attributesWrittenOnce) w.leaf('divisions', {}, divisions);
            w.open('key');
            w.leaf('fifths', {}, keyFifths);
            w.leaf('mode', {}, keyMode);
            w.close('key');
            if (masterBar.isFreeTime) {
                w.open('time', { symbol: 'single-number' });
                w.leaf('senza-misura');
                w.close('time');
            } else {
                w.open('time', masterBar.timeSignatureCommon ? { symbol: 'common' } : {});
                w.leaf('beats', {}, tsNum);
                w.leaf('beat-type', {}, tsDen);
                w.close('time');
            }
            if (numStaves > 1) w.leaf('staves', {}, numStaves);
            clefsNow.forEach((clef, si) => {
                const c = clefToXml(clef);
                w.open('clef', numStaves > 1 ? { number: si + 1 } : {});
                w.leaf('sign', {}, c.sign);
                if (c.sign !== 'percussion') w.leaf('line', {}, c.line);
                w.close('clef');
            });
            if (!attributesWrittenOnce) {
                // Tablature staff details, one per staff that has string tuning
                track.staves.forEach((staff, si) => {
                    if (staff.isPercussion) return;
                    const tunings = staff.stringTuning.tunings;
                    if (!tunings || tunings.length === 0) return;
                    w.open('staff-details', numStaves > 1 ? { number: si + 1 } : {});
                    w.leaf('staff-lines', {}, tunings.length);
                    // MusicXML staff-tuning line numbering matches AlphaTex's
                    // (string 1 = highest pitch), so reverse AlphaTab's array.
                    for (let s = 1; s <= tunings.length; s++) {
                        const midi = tunings[tunings.length - s];
                        const p = midiToPitch(midi, keyFifths);
                        w.open('staff-tuning', { line: s });
                        w.leaf('tuning-step', {}, p.step);
                        if (p.alter) w.leaf('tuning-alter', {}, p.alter);
                        w.leaf('tuning-octave', {}, p.octave);
                        w.close('staff-tuning');
                    }
                    w.close('staff-details');
                });
            }
            w.close('attributes');
            prevKeyFifths = keyFifths; prevKeyMode = keyMode;
            prevTsNum = tsNum; prevTsDen = tsDen;
            prevClef = clefsNow;
            attributesWrittenOnce = true;
        }

        // --- tempo marking (only when it changes) ---
        for (const auto of masterBar.tempoAutomations || []) {
            w.open('direction', { placement: 'above' });
            w.open('direction-type');
            w.open('metronome');
            w.leaf('beat-unit', {}, 'quarter');
            w.leaf('per-minute', {}, Math.round(auto.value));
            w.close('metronome');
            w.close('direction-type');
            w.leaf('sound', { tempo: Math.round(auto.value) });
            w.close('direction');
        }

        // --- barline left (repeat start) ---
        if (masterBar.isRepeatStart) {
            w.open('barline', { location: 'left' });
            w.leaf('bar-style', {}, 'heavy-light');
            w.leaf('repeat', { direction: 'forward' });
            w.close('barline');
        }

        // --- notes, staff by staff, voice by voice ---
        track.staves.forEach((staff, staffIndex) => {
            const bar = staff.bars[barIndex];
            const staffNumber = staffIndex + 1;

            bar.voices.forEach((voice, voiceIndex) => {
                const isFirstVoiceOverall = staffIndex === 0 && voiceIndex === 0;
                if (!isFirstVoiceOverall) {
                    // Rewind to the start of the measure for this voice/staff
                    const totalDuration = computeVoiceTotalDivisions(track, barIndex, divisions);
                    w.open('backup');
                    w.leaf('duration', {}, totalDuration);
                    w.close('backup');
                }
                const globalVoiceNumber = staffIndex * bar.voices.length + voiceIndex + 1;

                voice.beats.forEach((beat) => {
                    writeBeat(w, beat, {
                        staff, staffIndex, staffNumber, numStaves,
                        divisions, globalVoiceNumber, keyFifths,
                        lastDynamicByVoice
                    });
                });
            });
        });

        // --- barline right (repeat end / final) ---
        if (masterBar.repeatCount > 0) {
            w.open('barline', { location: 'right' });
            w.leaf('bar-style', {}, 'light-heavy');
            w.leaf('repeat', { direction: 'backward', times: masterBar.repeatCount + 1 });
            w.close('barline');
        } else if (barIndex === barCount - 1) {
            w.open('barline', { location: 'right' });
            w.leaf('bar-style', {}, 'light-heavy');
            w.close('barline');
        }

        w.close('measure');
    }

    w.close('part');
}

// Sum of the first voice's beat durations in a bar, used for <backup>.
// (All voices in a well-formed bar add up to the same total.)
function computeVoiceTotalDivisions(track, barIndex, divisions) {
    const bar = track.staves[0].bars[barIndex];
    const voice = bar.voices[0];
    let total = 0;
    for (const beat of voice.beats) total += beatDurationInDivisions(beat, divisions);
    return total;
}

function writeBeat(w, beat, ctx) {
    const { staff, staffNumber, numStaves, divisions, globalVoiceNumber, keyFifths, lastDynamicByVoice } = ctx;
    const durationDivisions = beatDurationInDivisions(beat, divisions);
    const typeName = DURATION_TYPE[beat.duration] || 'quarter';
    const hasTuplet = beat.tupletNumerator > 0 && beat.tupletDenominator > 0 &&
        beat.tupletNumerator !== beat.tupletDenominator;

    // Dynamics marking as its own <direction> before the note, but only
    // when the value actually changes for this voice (AlphaTab's model
    // carries the dynamic forward onto every beat internally).
    if (beat.dynamics !== undefined && beat.dynamics !== null) {
        const previous = lastDynamicByVoice.get(globalVoiceNumber);
        if (previous !== beat.dynamics) {
            lastDynamicByVoice.set(globalVoiceNumber, beat.dynamics);
            const tag = alphaTab.model.DynamicValue[beat.dynamics]?.toLowerCase();
            if (tag && DYNAMIC_TAGS.has(tag)) {
                w.open('direction', { placement: 'below' });
                w.open('direction-type');
                w.open('dynamics');
                w.leaf(tag);
                w.close('dynamics');
                w.close('direction-type');
                w.close('direction');
            }
        }
    }

    if (beat.isRest || beat.notes.length === 0) {
        w.open('note');
        w.leaf('rest');
        w.leaf('duration', {}, durationDivisions);
        w.leaf('voice', {}, globalVoiceNumber);
        w.leaf('type', {}, typeName);
        for (let d = 0; d < beat.dots; d++) w.leaf('dot');
        if (hasTuplet) {
            w.open('time-modification');
            w.leaf('actual-notes', {}, beat.tupletNumerator);
            w.leaf('normal-notes', {}, beat.tupletDenominator);
            w.close('time-modification');
        }
        if (numStaves > 1) w.leaf('staff', {}, staffNumber);
        w.close('note');
        return;
    }

    beat.notes.forEach((note, noteIndex) => {
        w.open('note');
        if (noteIndex > 0) w.leaf('chord');
        const p = midiToPitch(note.realValue, keyFifths);
        w.open('pitch');
        w.leaf('step', {}, p.step);
        if (p.alter) w.leaf('alter', {}, p.alter);
        w.leaf('octave', {}, p.octave);
        w.close('pitch');
        w.leaf('duration', {}, durationDivisions);
        if (note.tieDestination) w.leaf('tie', { type: 'start' });
        if (note.isTieDestination) w.leaf('tie', { type: 'stop' });
        w.leaf('voice', {}, globalVoiceNumber);
        w.leaf('type', {}, typeName);
        for (let d = 0; d < beat.dots; d++) w.leaf('dot');
        if (hasTuplet) {
            w.open('time-modification');
            w.leaf('actual-notes', {}, beat.tupletNumerator);
            w.leaf('normal-notes', {}, beat.tupletDenominator);
            w.close('time-modification');
        }
        if (numStaves > 1) w.leaf('staff', {}, staffNumber);

        writeNotations(w, note, beat, staff);

        w.close('note');
    });

    // (Lyrics are emitted inside writeNotations, attached to the beat's
    // first note, since MusicXML nests <lyric> inside <notations>.)
}

function writeNotations(w, note, beat, staff) {
    const hasTie = !!(note.tieDestination || note.isTieDestination);
    const hasArticulation = note.isStaccato || note.accentuated !== alphaTab.model.AccentuationType.None;
    const hasTechnical = note.fret >= 0 && note.string > 0;
    const hasSlide = note.slideOutType !== alphaTab.model.SlideOutType.None;
    const hasHammer = note.isHammerPullOrigin;
    const hasHarmonic = note.harmonicType !== alphaTab.model.HarmonicType.None;
    const hasBend = note.bendType !== alphaTab.model.BendType.None && note.bendPoints && note.bendPoints.length > 0;
    const hasOrnament = note.trillValue > 0;
    const isFirstNoteOfBeat = beat.notes[0] === note;
    const hasLyrics = isFirstNoteOfBeat && beat.lyrics && beat.lyrics.length > 0;

    if (!hasTie && !hasArticulation && !hasTechnical && !hasSlide && !hasHammer &&
        !hasHarmonic && !hasBend && !hasOrnament && !hasLyrics) return;

    w.open('notations');

    if (hasTie) {
        if (note.tieDestination) w.leaf('tied', { type: 'start' });
        if (note.isTieDestination) w.leaf('tied', { type: 'stop' });
    }

    if (hasSlide || hasHammer) {
        // slur is the generic MusicXML curve for legato-style connections
        if (hasHammer) w.leaf('slur', { type: 'start', number: 1 });
    }

    if (hasArticulation) {
        w.open('articulations');
        if (note.isStaccato) w.leaf('staccato');
        if (note.accentuated === alphaTab.model.AccentuationType.Normal) w.leaf('accent');
        if (note.accentuated === alphaTab.model.AccentuationType.Heavy) w.leaf('strong-accent');
        if (note.accentuated === alphaTab.model.AccentuationType.Tenuto) w.leaf('tenuto');
        w.close('articulations');
    }

    if (hasOrnament) {
        w.open('ornaments');
        w.leaf('trill-mark');
        w.close('ornaments');
    }

    if (hasTechnical || hasSlide || hasHammer || hasHarmonic || hasBend) {
        w.open('technical');
        if (hasTechnical) {
            w.leaf('fret', {}, note.fret);
            w.leaf('string', {}, toXmlStringNumber(note, staff));
        }
        if (hasHammer) {
            const dest = note.hammerPullDestination;
            const label = dest && dest.fret < note.fret ? 'pull-off' : 'hammer-on';
            w.leaf(label, { type: 'start' });
        }
        if (note.isHammerPullDestination) {
            const origin = note.hammerPullOrigin;
            const label = origin && note.fret < origin.fret ? 'pull-off' : 'hammer-on';
            w.leaf(label, { type: 'stop' });
        }
        if (hasSlide) {
            const legato = note.slideOutType === alphaTab.model.SlideOutType.Legato;
            w.leaf('slide', { type: 'start', 'line-type': legato ? 'solid' : 'solid' });
        }
        if (hasHarmonic) {
            w.open('harmonic');
            if (note.harmonicType === alphaTab.model.HarmonicType.Natural) w.leaf('natural');
            else w.leaf('artificial');
            w.close('harmonic');
        }
        if (hasBend) {
            const maxSemitoneQuarterTones = Math.max(...note.bendPoints.map(p => p.value));
            w.open('bend');
            w.leaf('bend-alter', {}, (maxSemitoneQuarterTones / 2).toFixed(2));
            w.close('bend');
        }
        w.close('technical');
    }

    if (hasLyrics) {
        beat.lyrics.forEach((line, i) => {
            w.open('lyric', { number: i + 1 });
            w.leaf('syllabic', {}, 'single');
            w.leaf('text', {}, line);
            w.close('lyric');
        });
    }

    w.close('notations');
}
