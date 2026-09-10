import { convertAlphaTexToMusicXml } from './converter.mjs';

const texInput = document.getElementById('tex-input');
const xmlOutput = document.getElementById('xml-output');
const convertBtn = document.getElementById('convert-btn');
const downloadBtn = document.getElementById('download-btn');
const statusEl = document.getElementById('status');
const errorBox = document.getElementById('error-box');
const fileInput = document.getElementById('file-input');
const loadExampleBtn = document.getElementById('load-example');

const EXAMPLE = `\\title "Exemple"
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
  const source = texInput.value.trim();
  clearError();
  downloadBtn.hidden = true;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  if (!source) {
    showError('Colle ou charge d\u2019abord une source AlphaTex.');
    return;
  }

  setStatus('Conversion en cours…', 'busy');
  convertBtn.disabled = true;

  // yield to the browser so the "busy" status actually paints before
  // the (synchronous, CPU-bound) conversion runs
  await new Promise(requestAnimationFrame);

  try {
    const xml = convertAlphaTexToMusicXml(source);
    xmlOutput.textContent = xml;
    const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
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

loadExampleBtn.addEventListener('click', () => {
  texInput.value = EXAMPLE;
  clearError();
  setStatus('');
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  texInput.value = await file.text();
  clearError();
  setStatus('');
  fileInput.value = '';
});

// Drag & drop a .alphatex file anywhere onto the input panel
const inputPanel = document.querySelector('.input-panel');
['dragover', 'dragenter'].forEach(evt =>
  inputPanel.addEventListener(evt, (e) => { e.preventDefault(); inputPanel.style.borderColor = 'var(--brass)'; })
);
['dragleave', 'drop'].forEach(evt =>
  inputPanel.addEventListener(evt, (e) => { e.preventDefault(); inputPanel.style.borderColor = ''; })
);
inputPanel.addEventListener('drop', async (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  texInput.value = await file.text();
  clearError();
  setStatus('');
});

// Register the service worker for offline use (only over HTTPS or localhost)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
