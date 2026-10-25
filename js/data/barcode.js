// Codes-barres alimentaires (EAN-13, EAN-8, UPC-A, UPC-E, GTIN-14) : contrôle et forme canonique.
// La forme canonique suit la règle d'Open Food Facts : on retire les 0 de tête, puis on complète
// à 8 chiffres (codes courts) ou à 13 chiffres (codes de 9 à 12 chiffres). Ainsi « 034000470693 »
// (UPC-A) et « 0034000470693 » (EAN-13) désignent le même produit.

/** Chiffre de contrôle GTIN (modulo 10) pour les 8, 12, 13 ou 14 chiffres. */
function gtinCheckOk(digits) {
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** UPC-E (8 chiffres, système 0 ou 1) → UPC-A (12 chiffres) ; null si impossible. */
export function expandUpcE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const s = code[0];
  const m = code.slice(1, 7);
  const check = code[7];
  const last = m[5];
  let body;
  if ('012'.includes(last)) body = `${m[0]}${m[1]}${last}0000${m[2]}${m[3]}${m[4]}`;
  else if (last === '3') body = `${m[0]}${m[1]}${m[2]}00000${m[3]}${m[4]}`;
  else if (last === '4') body = `${m[0]}${m[1]}${m[2]}${m[3]}00000${m[4]}`;
  else body = `${m[0]}${m[1]}${m[2]}${m[3]}${m[4]}0000${last}`;
  return `${s}${body}${check}`;
}

/**
 * Vérifie un code saisi à la main.
 * Renvoie { ok: true, code } ou { ok: false, message }.
 */
export function checkBarcode(input) {
  const raw = String(input ?? '').replace(/[\s-]/g, '');
  if (!raw) return { ok: false, message: 'Saisissez les chiffres sous le code-barres.' };
  if (!/^\d+$/.test(raw)) return { ok: false, message: 'Le code ne doit contenir que des chiffres.' };
  if (raw.length < 6 || raw.length > 14) return { ok: false, message: 'Un code-barres alimentaire compte 8, 12 ou 13 chiffres.' };
  if ([8, 12, 13, 14].includes(raw.length)) {
    const ok = gtinCheckOk(raw) || (raw.length === 8 && expandUpcE(raw) !== null && gtinCheckOk(expandUpcE(raw)));
    if (!ok) return { ok: false, message: 'Le dernier chiffre ne correspond pas au reste du code : vérifiez la saisie.' };
  }
  return { ok: true, code: raw };
}

/** Forme canonique (règle Open Food Facts) ; null si le code n'est pas exploitable. */
export function canonicalBarcode(input) {
  const raw = String(input ?? '').replace(/[\s-]/g, '');
  if (!/^\d{1,14}$/.test(raw)) return null;
  const stripped = raw.replace(/^0+/, '');
  if (!stripped) return null;
  if (stripped.length <= 8) return stripped.padStart(8, '0');
  if (stripped.length <= 13) return stripped.padStart(13, '0');
  return stripped; // 14 chiffres sans 0 de tête (GTIN-14)
}
