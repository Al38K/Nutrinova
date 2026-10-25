#!/usr/bin/env python3
"""Convertit la table Ciqual officielle de l'ANSES (Excel .xlsx/.xls ou export .csv) en data/ciqual.json.

Usage : python3 tools/build-ciqual.py <fichier Ciqual> <version> <date de publication AAAA-MM-JJ>
Exemple : python3 tools/build-ciqual.py Table_Ciqual_2025.xlsx 2025 2025-11-19

Règles (aucune valeur inventée) :
- valeur vide ou « - » : inconnue → null ;
- « traces » ou « < seuil » : quantité inférieure au seuil de mesure → 0, comme l'autorise
  l'étiquetage européen pour les valeurs négligeables ;
- toutes les autres valeurs sont reprises telles quelles (virgule décimale convertie).
Colonnes reprises : énergie (règlement UE 1169/2011, kcal), protéines (N x facteur de Jones),
glucides, lipides, sucres, fibres alimentaires, sel chlorure de sodium, alcool, pour 100 g.
Le script s'arrête avec un message clair si une colonne attendue est introuvable.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

FIELDS = ['code', 'name', 'group', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'salt', 'alcohol']

# Colonnes recherchées par motif, version française ou anglaise du fichier
# (insensible aux accents, à la casse, aux retours à la ligne et aux « / »).
PATTERNS = {
    'code': r'^alim_code$',
    'name': r'^alim_nom_(fr|eng)$',
    'grp': r'^alim_grp_nom_(fr|eng)$',
    'ssgrp': r'^alim_ssgrp_nom_(fr|eng)$',
    'kcal': r'^(energie|energy),? (reglement|regulation) (ue|eu) no? ?1169 2011 \(kcal 100 ?g\)$',
    'protein': r'^(proteines|protein)(, n ?x ?facteur de jones)? \(g 100 ?g\)$',
    'carbs': r'^(glucides|carbohydrate) \(g 100 ?g\)$',
    'fat': r'^(lipides|fat) \(g 100 ?g\)$',
    'fiber': r'^(fibres alimentaires|fibres|dietary fibre) \(g 100 ?g\)$',
    'sugars': r'^(sucres|sugars) \(g 100 ?g\)$',
    'salt': r'^(sel chlorure de sodium|sel|salt) \(g 100 ?g\)$',
    'alcohol': r'^(alcool|alcohol)( \(ethanol\))? \(g 100 ?g\)$',
}
MAX = {'kcal': 1000}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[\s/]+', ' ', s).strip().lower()


def read_rows(path):
    p = Path(path)
    if p.suffix.lower() == '.xlsx':
        import openpyxl
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
    elif p.suffix.lower() == '.xls':
        import xlrd
        ws = xlrd.open_workbook(p).sheet_by_index(0)
        rows = [ws.row_values(i) for i in range(ws.nrows)]  # 1re feuille : composition
    elif p.suffix.lower() in ('.csv', '.tsv'):
        import csv
        with open(p, encoding='utf-8-sig', newline='') as fh:
            sample = fh.read(4096)
            fh.seek(0)
            delim = '\t' if sample.count('\t') > sample.count(';') else ';'
            rows = list(csv.reader(fh, delimiter=delim))
    else:
        sys.exit(f'Format non pris en charge : {p.suffix} (attendu .xlsx, .xls ou .csv)')
    return rows


def value(raw, key, code):
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        v = float(raw)
    else:
        s = norm(raw)
        if s in ('', '-'):
            return None
        if s == 'traces' or s.startswith('<'):
            return 0.0
        try:
            v = float(s.replace(',', '.').replace(' ', ''))
        except ValueError:
            sys.exit(f'Valeur illisible pour {key}, aliment {code} : {raw!r}')
    if v < 0 or v > MAX.get(key, 100):
        sys.exit(f'Valeur impossible pour {key}, aliment {code} : {raw!r}')
    return round(v, 4)


def main():
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    src, version, published = sys.argv[1:4]
    rows = read_rows(src)
    header = [norm(c) for c in rows[0]]
    col = {}
    for key, pat in PATTERNS.items():
        hits = [i for i, h in enumerate(header) if re.match(pat, h)]
        if len(hits) != 1:
            sys.exit(f'Colonne « {key} » : {len(hits)} correspondance(s) dans l\'en-tête. Colonnes : {header}')
        col[key] = hits[0]

    groups, group_index, items, seen = [], {}, [], set()
    for r in rows[1:]:
        if r is None or r[col['code']] in (None, ''):
            continue
        raw_code = r[col['code']]
        code = str(int(raw_code)) if isinstance(raw_code, float) else str(raw_code).strip()
        if code in seen:
            sys.exit(f'Code en double : {code}')
        seen.add(code)
        name = re.sub(r'\s+', ' ', str(r[col['name']] or '')).strip()
        if not name:
            sys.exit(f'Nom manquant pour le code {code}')
        g = str(r[col['ssgrp']] or '').strip()
        if g in ('', '-'):
            g = str(r[col['grp']] or '').strip()
        g = g if g not in ('', '-') else None
        if g is not None and g not in group_index:
            group_index[g] = len(groups)
            groups.append(g)
        vals = [value(r[col[k]], k, code) for k in FIELDS[3:]]
        items.append([code, name, group_index[g] if g is not None else None, *vals])

    items.sort(key=lambda it: it[1].lower())
    out = {
        'format': 'nutrinova-ciqual',
        'formatVersion': 1,
        'version': version,
        'published': published,
        'source': f'ANSES, table de composition nutritionnelle des aliments Ciqual {version}',
        'license': 'Licence Ouverte / Etalab 2.0',
        'url': 'https://ciqual.anses.fr/',
        'lang': 'fr' if header[col['name']].endswith('_fr') else 'en',
        'rules': 'Valeurs pour 100 g. Valeur absente : vide. « traces » et « < seuil » : 0.',
        'count': len(items),
        'groups': groups,
        'fields': FIELDS,
        'items': items,
    }
    dest = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(__file__).resolve().parent.parent / 'data' / 'ciqual.json'
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(items)} aliments, {len(groups)} sous-groupes → {dest}')


if __name__ == '__main__':
    main()
