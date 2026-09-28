#!/usr/bin/env python3
"""
Convert TeX Gyre Termes (CFF outlines) to TrueType outlines, so pdf-lib embeds it
correctly. The result is renamed "UNN Appraisal Termes", as the GUST Font License
asks of modified versions; the licence travels with it in vendor/LICENSES.

Needs fontTools:  python3 -m venv .venv && .venv/bin/pip install fonttools
Run:              .venv/bin/python tools/otf2ttf.py
"""
import os
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

SRC = '/usr/share/texmf/fonts/opentype/public/tex-gyre'
OUT = os.path.join(os.path.dirname(__file__), '..', 'vendor', 'fonts')
STYLES = {'regular': 'Regular', 'bold': 'Bold', 'italic': 'Italic', 'bolditalic': 'Bold Italic'}

def convert(src, dst, style):
    font = TTFont(src)
    order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable('glyf')
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(gs)
        gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    font['glyf'] = glyf
    font['loca'] = newTable('loca')
    del font['CFF ']
    if 'VORG' in font: del font['VORG']
    font['head'].glyphDataFormat = 0
    maxp = font['maxp']
    maxp.tableVersion = 0x00010000
    for k in ('maxZones', 'maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs',
              'maxStackElements', 'maxSizeOfInstructions', 'maxComponentElements'):
        setattr(maxp, k, 0)
    maxp.maxZones = 1
    post = font['post']
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = order
    font.sfntVersion = '\x00\x01\x00\x00'
    family = 'UNN Appraisal Termes'
    ps = f"UNNAppraisalTermes-{STYLES[style].replace(' ', '')}"
    for rec in font['name'].names:
        if rec.nameID in (1, 16): rec.string = family
        elif rec.nameID == 4: rec.string = f'{family} {STYLES[style]}'
        elif rec.nameID == 6: rec.string = ps
        elif rec.nameID == 3: rec.string = f'{ps};derived from TeX Gyre Termes'
    font.recalcTimestamp = False
    font.save(dst)

for s in STYLES:
    dst = os.path.join(OUT, f'termes-{s}.ttf')
    convert(os.path.join(SRC, f'texgyretermes-{s}.otf'), dst, s)
    print(dst, os.path.getsize(dst))

# Reduce each face to the scripts a UNN dossier needs, so embedding it whole stays small.
# fontkit's own subsetter drops glyphs from these fonts, so the booklet embeds them unsubset.
from fontTools import subset as _subset
KEEP = ('U+0020-007E,U+00A0-024F,U+0250-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,'
        'U+2100-214F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+2022,U+2026,U+FB00-FB06')
for s in STYLES:
    path = os.path.join(OUT, f'termes-{s}.ttf')
    opts = _subset.Options()
    opts.layout_features = ['kern', 'liga']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.recalc_timestamp = False
    font = TTFont(path)
    sub = _subset.Subsetter(opts)
    sub.populate(unicodes=_subset.parse_unicodes(KEEP))
    sub.subset(font)
    font.recalcTimestamp = False
    font.save(path)
    print('reduced', path, os.path.getsize(path))
