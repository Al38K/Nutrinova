// Lecture d'un code-barres avec la caméra arrière de l'iPhone.
// Safari ne propose pas (ou pas toujours) l'API BarcodeDetector : on utilise alors ZXing
// (zxing-cpp compilé en WebAssembly, fichiers dans vendor/, disponibles hors ligne).
// Formats lus : EAN-13, EAN-8, UPC-A, UPC-E. Repli permanent : saisie manuelle du code.

import { h, iconEl, openSheet, fieldControl } from '../ui.js';
import { checkBarcode } from '../data/barcode.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const PONYFILL_SRC = 'vendor/barcode-detector/ponyfill.js';
const WASM_SRC = 'vendor/barcode-detector/zxing_reader.wasm';
const SCAN_INTERVAL_MS = 90;
const CONFIRM_WINDOW_MS = 1500;

let detectorPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Lecteur de codes-barres non chargé. Rouvrez l\'app connectée à internet une fois.'));
    document.head.append(s);
  });
}

/** Détecteur prêt à l'emploi : natif si Safari le propose pour ces formats, sinon ZXing. */
export function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    if ('BarcodeDetector' in window && typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (FORMATS.every((f) => supported.includes(f))) {
          return { detector: new window.BarcodeDetector({ formats: FORMATS }), engine: 'natif' };
        }
      } catch { /* on passe à ZXing */ }
    }
    if (!window.BarcodeDetectionAPI) await loadScript(PONYFILL_SRC);
    const api = window.BarcodeDetectionAPI;
    if (!api || typeof api.BarcodeDetector !== 'function') throw new Error('Lecteur de codes-barres indisponible.');
    const wasmUrl = new URL(WASM_SRC, document.baseURI).href;
    await api.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
      fireImmediately: true
    });
    return { detector: new api.BarcodeDetector({ formats: FORMATS }), engine: 'ZXing' };
  })().catch((err) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

function cameraErrorText(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Accès à la caméra refusé. Pour l\'autoriser : Réglages de l\'iPhone › Apps › Safari › Caméra › « Demander » ou « Autoriser », puis rouvrez nutrinova. En attendant, saisissez le code à la main.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Aucune caméra arrière disponible. Saisissez le code à la main.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'La caméra est utilisée par une autre app. Fermez-la, puis réessayez.';
  return `Caméra indisponible : ${err && err.message ? err.message : err}. Saisissez le code à la main.`;
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    const e = new Error('connexion sécurisée (https) requise');
    e.name = 'InsecureContext';
    throw e;
  }
  const ideal = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
  try {
    return await navigator.mediaDevices.getUserMedia(ideal);
  } catch (err) {
    if (err && err.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
    }
    throw err;
  }
}

/** Saisie manuelle du code (repli). onCode(code) reçoit les chiffres vérifiés. */
export function openManualBarcode({ onCode, initial = '' }) {
  openSheet({
    title: 'Saisir le code-barres',
    closeLabel: 'Annuler',
    content: (close) => {
      const field = fieldControl({
        label: 'Chiffres sous le code-barres',
        id: 'manual-barcode',
        value: initial,
        inputmode: 'numeric',
        placeholder: 'ex. 3017620422003',
        maxlength: 18,
        autofocus: true,
        enterkeyhint: 'search'
      });
      field.input.setAttribute('pattern', '[0-9]*');
      const submit = () => {
        const res = checkBarcode(field.input.value);
        if (!res.ok) {
          field.setError(res.message);
          return;
        }
        close();
        onCode(res.code);
      };
      return h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
        field.root,
        h('p', { class: 'hint' }, '8, 12 ou 13 chiffres, sans espace. Le dernier chiffre sert de contrôle : une faute de frappe est détectée.'),
        h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Rechercher ce produit')
      );
    }
  });
}

/**
 * Ouvre le lecteur plein écran.
 * onCode(code) : code lu (chiffres) ; onManual() : l'utilisateur préfère saisir le code.
 */
export function openScanner({ onCode, onManual }) {
  const video = h('video', { class: 'scanner-video', playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
  video.muted = true;
  video.setAttribute('webkit-playsinline', '');
  const status = h('p', { class: 'scanner-status', 'aria-live': 'polite' }, 'Ouverture de la caméra…');
  const zoomBtn = h('button', { type: 'button', class: 'scanner-chip', hidden: true, 'aria-label': 'Zoom' }, '1×');
  const frame = h('div', { class: 'scanner-frame' }, h('span', { class: 'scanner-line' }));
  const dialog = h('dialog', { class: 'scanner', 'aria-label': 'Scanner un code-barres' },
    video,
    h('div', { class: 'scanner-shade', 'aria-hidden': 'true' }, frame),
    h('div', { class: 'scanner-top' },
      h('button', { type: 'button', class: 'scanner-chip', onclick: () => close() }, 'Fermer'),
      h('span', { class: 'scanner-title' }, 'Code-barres'),
      zoomBtn
    ),
    h('div', { class: 'scanner-bottom' },
      status,
      h('button', {
        type: 'button',
        class: 'btn btn-lg btn-block scanner-manual',
        onclick: () => { close(); if (onManual) onManual(); }
      }, iconEl('keyboard'), 'Saisir le code')
    )
  );

  let stream = null;
  let timer = null;
  let closed = false;
  let last = null;
  let lastAt = 0;

  function stopCamera() {
    clearTimeout(timer);
    timer = null;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    video.srcObject = null;
  }

  function close() {
    if (closed) return;
    closed = true;
    stopCamera();
    document.removeEventListener('visibilitychange', onVisibility);
    if (dialog.open) dialog.close();
  }

  function onVisibility() {
    // iOS coupe la caméra quand l'app passe en arrière-plan : on ferme proprement.
    if (document.visibilityState === 'hidden') close();
  }

  function found(code) {
    frame.classList.add('is-found');
    status.textContent = `Code lu : ${code}`;
    setTimeout(() => {
      close();
      onCode(code);
    }, 180);
  }

  async function loop(detector) {
    if (closed) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((c) => /^\d{6,14}$/.test(c.rawValue || ''));
        if (hit) {
          const now = Date.now();
          // Deux lectures identiques de suite : évite une erreur de lecture isolée.
          if (hit.rawValue === last && now - lastAt < CONFIRM_WINDOW_MS) {
            found(hit.rawValue);
            return;
          }
          last = hit.rawValue;
          lastAt = now;
        }
      } catch { /* image illisible : on continue */ }
    }
    if (!closed) timer = setTimeout(() => loop(detector), SCAN_INTERVAL_MS);
  }

  function setupZoom() {
    const track = stream && stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return;
    let caps;
    try { caps = track.getCapabilities(); } catch { return; }
    if (!caps || !caps.zoom || !(caps.zoom.max >= 2)) return;
    const levels = [Math.max(1, caps.zoom.min || 1), 2];
    let i = 0;
    zoomBtn.hidden = false;
    zoomBtn.addEventListener('click', async () => {
      i = (i + 1) % levels.length;
      try {
        await track.applyConstraints({ advanced: [{ zoom: levels[i] }] });
        zoomBtn.textContent = `${levels[i]}×`;
      } catch { zoomBtn.hidden = true; }
    });
  }

  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('close', () => { stopCamera(); dialog.remove(); });
  document.addEventListener('visibilitychange', onVisibility);
  document.body.append(dialog);
  dialog.showModal();

  (async () => {
    try {
      // Caméra et lecteur se préparent en parallèle.
      const [s, det] = await Promise.all([startCamera(), getDetector().catch((err) => ({ error: err }))]);
      if (closed) { for (const t of s.getTracks()) t.stop(); return; }
      stream = s;
      video.srcObject = stream;
      try { await video.play(); } catch { /* lecture auto refusée : la vidéo démarre au premier toucher */ }
      setupZoom();
      if (det.error) {
        status.textContent = `${det.error.message} Saisissez le code à la main.`;
        return;
      }
      status.textContent = 'Placez le code-barres dans le cadre, à 15–20 cm.';
      loop(det.detector);
    } catch (err) {
      if (closed) return;
      stopCamera();
      dialog.classList.add('is-error');
      status.textContent = err && err.name === 'InsecureContext'
        ? 'La caméra n\'est disponible que sur l\'adresse https de l\'app. Saisissez le code à la main.'
        : cameraErrorText(err);
    }
  })();

  return { close };
}
