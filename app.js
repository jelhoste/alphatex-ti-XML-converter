import { convertAlphaTexToMusicXml } from './converter.mjs';
import { convertMusicXmlToAlphaTex } from './converter-x2t.mjs';
import { convertAlphaTexToGp } from './converter-t2gp.mjs';
import { convertGpToAlphaTex } from './converter-gp2t.mjs';

const texInput = document.getElementById('tex-input');
const xmlOutput = document.getElementById('xml-output');
const binaryDrop = document.getElementById('binary-drop');
const binaryDropText = document.getElementById('binary-drop-text');
const binaryOutput = document.getElementById('binary-output');
const binaryOutputText = document.getElementById('binary-output-text');
const convertBtn = document.getElementById('convert-btn');
const downloadBtn = document.getElementById('download-btn');
const statusEl = document.getElementById('status');
const errorBox = document.getElementById('error-box');
const fileInput = document.getElementById('file-input');
const loadExampleBtn = document.getElementById('load-example');
const inputLabel = document.getElementById('input-label');
const outputLabel = document.getElementById('output-label');
const dirButtons = Array.from(document.querySelectorAll('.dir-btn'));
const inputPanel = document.querySelector('.input-panel');

const EXAMPLE_ALPHATEX = `\\title "Exemple"
\\artist "AlphaTex"
\\tempo 100
.
\\ts 4 4
:4 0.6{dy f} 0.5 2.4 3.3 |
\\ts 3 4
:8 0.6{tu 3} 2.6{tu 3} 3.5{tu 3} 2.5.16 2.5.16 0.5.8 |
:4 0.6{dy mf} 2.6 0.4.4 |
:4 (0.6 0.5 0.4)
`;

const EXAMPLE_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Guitar</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>
`;

// Each mode declares: labels, whether input/output are 'text' or 'binary',
// which file extensions to accept, the download filename/mime, and the
// conversion function itself.
const MODES = {
  tex2xml: {
    inputLabel: 'Source AlphaTex',
    outputLabel: 'Aperçu MusicXML',
    convertLabel: 'Convertir en MusicXML',
    inputType: 'text',
    outputType: 'text',
    fileAccept: '.alphatex,.txt',
    placeholder: '\\title "Mon morceau"\n\\tempo 100\n.\n\\ts 4 4\n:4 0.6 0.5 2.4 3.3 |',
    downloadName: 'score.xml',
    downloadMime: 'application/vnd.recordare.musicxml+xml',
    example: EXAMPLE_ALPHATEX,
    convert: (source) => convertAlphaTexToMusicXml(source)
  },
  xml2tex: {
    inputLabel: 'Source MusicXML',
    outputLabel: 'Aperçu AlphaTex',
    convertLabel: 'Convertir en AlphaTex',
    inputType: 'text',
    outputType: 'text',
    fileAccept: '.xml,.musicxml',
    placeholder: '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n  ...',
    downloadName: 'score.alphatex',
    downloadMime: 'text/plain',
    example: EXAMPLE_MUSICXML,
    convert: (source) => convertMusicXmlToAlphaTex(source)
  },
  tex2gp: {
    inputLabel: 'Source AlphaTex',
    outputLabel: 'Fichier Guitar Pro',
    convertLabel: 'Convertir en Guitar Pro',
    inputType: 'text',
    outputType: 'binary',
    fileAccept: '.alphatex,.txt',
    placeholder: '\\title "Mon morceau"\n\\tempo 100\n.\n\\ts 4 4\n:4 0.6 0.5 2.4 3.3 |',
    downloadName: 'score.gp',
    downloadMime: 'application/octet-stream',
    example: EXAMPLE_ALPHATEX,
    convert: (source) => convertAlphaTexToGp(source) // -> Uint8Array
  },
  gp2tex: {
    inputLabel: 'Fichier Guitar Pro',
    outputLabel: 'Aperçu AlphaTex',
    convertLabel: 'Convertir en AlphaTex',
    inputType: 'binary',
    outputType: 'text',
    fileAccept: '.gp,.gpx,.gp3,.gp4,.gp5',
    downloadName: 'score.alphatex',
    downloadMime: 'text/plain',
    example: null, // no bundled example (binary) — user must supply a file
    convert: (bytes) => convertGpToAlphaTex(bytes) // bytes: Uint8Array
  }
};

let mode = 'tex2xml';
// Holds the loaded binary payload when the current mode's input is binary
let loadedBinary = null;
let loadedBinaryName = '';

function applyMode() {
  const cfg = MODES[mode];

  dirButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  inputLabel.textContent = cfg.inputLabel;
  outputLabel.textContent = cfg.outputLabel;
  convertBtn.textContent = cfg.convertLabel;
  fileInput.accept = cfg.fileAccept;
  downloadBtn.download = cfg.downloadName;
  loadExampleBtn.hidden = !cfg.example;

  const isBinaryInput = cfg.inputType === 'binary';
  texInput.hidden = isBinaryInput;
  binaryDrop.hidden = !isBinaryInput;
  if (isBinaryInput) {
    binaryDropText.textContent = loadedBinary
      ? `Fichier chargé : ${loadedBinaryName} (${loadedBinary.byteLength} octets)`
      : 'Glisse un fichier Guitar Pro ici, ou utilise « Ouvrir un fichier ».';
  } else {
    texInput.placeholder = cfg.placeholder;
  }

  resetOutput();
}

function resetOutput() {
  const cfg = MODES[mode];
  const isBinaryOutput = cfg.outputType === 'binary';
  xmlOutput.hidden = isBinaryOutput;
  binaryOutput.hidden = !isBinaryOutput;
  xmlOutput.textContent = 'Le résultat apparaîtra ici après conversion.';
  binaryOutputText.textContent = 'Le fichier généré apparaîtra ici après conversion.';
  downloadBtn.hidden = true;
  clearError();
  setStatus('');
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

let currentObjectUrl = null;

async function convert() {
  const cfg = MODES[mode];
  clearError();
  downloadBtn.hidden = true;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  const input = cfg.inputType === 'binary' ? loadedBinary : texInput.value.trim();
  if (!input || (cfg.inputType === 'text' && input.length === 0)) {
    showError(cfg.inputType === 'binary'
      ? 'Charge d\u2019abord un fichier Guitar Pro.'
      : 'Colle ou charge d\u2019abord une source.');
    return;
  }

  setStatus('Conversion en cours…', 'busy');
  convertBtn.disabled = true;
  await new Promise(requestAnimationFrame);

  try {
    const result = cfg.convert(input);

    if (cfg.outputType === 'binary') {
      binaryOutputText.textContent = `Fichier ${cfg.downloadName} généré (${result.byteLength} octets).`;
    } else {
      xmlOutput.textContent = result;
    }

    const blob = cfg.outputType === 'binary'
      ? new Blob([result], { type: cfg.downloadMime })
      : new Blob([result], { type: cfg.downloadMime });
    currentObjectUrl = URL.createObjectURL(blob);
    downloadBtn.href = currentObjectUrl;
    downloadBtn.hidden = false;
    setStatus('Conversion réussie.', 'ok');
  } catch (err) {
    console.error(err);
    showError('Échec de la conversion : ' + (err && err.message ? err.message : String(err)));
    setStatus('');
  } finally {
    convertBtn.disabled = false;
  }
}

convertBtn.addEventListener('click', convert);

dirButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    loadedBinary = null;
    loadedBinaryName = '';
    applyMode();
  });
});

loadExampleBtn.addEventListener('click', () => {
  const cfg = MODES[mode];
  if (cfg.example) texInput.value = cfg.example;
  clearError();
  setStatus('');
});

async function loadFile(file) {
  const cfg = MODES[mode];
  if (cfg.inputType === 'binary') {
    loadedBinary = new Uint8Array(await file.arrayBuffer());
    loadedBinaryName = file.name;
    binaryDropText.textContent = `Fichier chargé : ${file.name} (${loadedBinary.byteLength} octets)`;
  } else {
    texInput.value = await file.text();
  }
  clearError();
  setStatus('');
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  await loadFile(file);
  fileInput.value = '';
});

['dragover', 'dragenter'].forEach(evt =>
  inputPanel.addEventListener(evt, (e) => { e.preventDefault(); inputPanel.style.borderColor = 'var(--brass)'; })
);
['dragleave', 'drop'].forEach(evt =>
  inputPanel.addEventListener(evt, (e) => { e.preventDefault(); inputPanel.style.borderColor = ''; })
);
inputPanel.addEventListener('drop', async (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  await loadFile(file);
});

// Register the service worker for offline use (only over HTTPS or localhost)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

applyMode();
