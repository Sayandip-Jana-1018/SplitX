"""
svgkit — tiny layout + SVG primitives for the SplitX synopsis.

Everything is measured, so boxes cannot overflow: text is wrapped to the real
pixel budget of its container and blocks are vertically centred.
"""

from html import escape as _h

# ────────────────────────────────────────────────────────────── text metrics ──

_CW = {}

# Times New Roman advance widths, in 1/1000 em, from the font's own metrics.
_TNR = {
    " ": 250, "!": 333, '"': 408, "#": 500, "$": 500, "%": 833, "&": 778,
    "'": 180, "(": 333, ")": 333, "*": 500, "+": 564, ",": 250, "-": 333,
    ".": 250, "/": 278,
    "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500,
    "7": 500, "8": 500, "9": 500,
    ":": 278, ";": 278, "<": 564, "=": 564, ">": 564, "?": 444, "@": 921,
    "A": 722, "B": 667, "C": 667, "D": 722, "E": 611, "F": 556, "G": 722,
    "H": 722, "I": 333, "J": 389, "K": 722, "L": 611, "M": 889, "N": 722,
    "O": 722, "P": 556, "Q": 722, "R": 667, "S": 556, "T": 611, "U": 722,
    "V": 722, "W": 944, "X": 722, "Y": 722, "Z": 611,
    "[": 333, "\\": 278, "]": 333, "^": 469, "_": 500, "`": 333,
    "a": 444, "b": 500, "c": 444, "d": 500, "e": 444, "f": 333, "g": 500,
    "h": 500, "i": 278, "j": 278, "k": 500, "l": 278, "m": 778, "n": 500,
    "o": 500, "p": 500, "q": 500, "r": 333, "s": 389, "t": 278, "u": 500,
    "v": 500, "w": 722, "x": 500, "y": 500, "z": 444,
    "{": 480, "|": 200, "}": 480, "~": 541,
    # punctuation and symbols the diagrams actually use
    "\u00ab": 500, "\u00bb": 500, "\u00b7": 250, "\u00d7": 564, "\u00f7": 564,
    "\u2014": 1000, "\u2013": 500, "\u2018": 333, "\u2019": 333,
    "\u201c": 444, "\u201d": 444, "\u2026": 1000, "\u2212": 564,
    "\u2192": 1000, "\u2190": 1000, "\u2191": 1000, "\u2193": 1000,
    "\u2194": 1000, "\u21b3": 1000, "\u221e": 750, "\u2248": 564,
    "\u2264": 564, "\u2265": 564, "\u2260": 564, "\u03a3": 611,
    "\u20b9": 500, "\u00a9": 760, "\u2713": 700, "\u2715": 700,
    "\u25c6": 700, "\u2665": 700, "\u2764": 700,
}

# Bold faces run a few percent wider than regular and most diagram labels are
# bold, so carry a small margin: text wraps a little early rather than spilling.
_BOLD_MARGIN = 1.035


def _init_widths():
    for ch, w in _TNR.items():
        _CW[ch] = w / 1000.0 * _BOLD_MARGIN


_init_widths()


def esc(s):
    return _h(str(s), quote=False)


def tw(s, fs):
    """Approximate rendered width of `s` at font-size `fs`."""
    return fs * sum(_CW.get(c, 0.500) for c in str(s))


def wrap(s, fs, maxw, max_lines=99):
    """Greedy wrap to a pixel budget; hard-splits any single over-long word."""
    if s is None:
        return []
    words = str(s).split()
    lines, cur = [], ""
    for w in words:
        cand = w if not cur else cur + " " + w
        if cur and tw(cand, fs) > maxw:
            lines.append(cur)
            cur = w
        else:
            cur = cand
        while tw(cur, fs) > maxw and len(cur) > 1:
            cut = len(cur)
            while cut > 1 and tw(cur[:cut], fs) > maxw:
                cut -= 1
            lines.append(cur[:cut])
            cur = cur[cut:]
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    return lines


# ───────────────────────────────────────────────────────────────── geometry ──


class R:
    """A rectangle with splitting helpers. All units are viewBox units."""

    __slots__ = ("x", "y", "w", "h")

    def __init__(self, x, y, w, h):
        self.x, self.y, self.w, self.h = float(x), float(y), float(w), float(h)

    # edges / centres
    @property
    def x2(self):
        return self.x + self.w

    @property
    def y2(self):
        return self.y + self.h

    @property
    def cx(self):
        return self.x + self.w / 2

    @property
    def cy(self):
        return self.y + self.h / 2

    def t(self):
        return (self.cx, self.y)

    def b(self):
        return (self.cx, self.y2)

    def l(self):
        return (self.x, self.cy)

    def r(self):
        return (self.x2, self.cy)

    def inset(self, all=None, top=0, right=0, bottom=0, left=0):
        if all is not None:
            top = right = bottom = left = all
        return R(self.x + left, self.y + top,
                 max(1.0, self.w - left - right), max(1.0, self.h - top - bottom))

    def cols(self, n=None, gap=8, weights=None):
        weights = weights or [1] * (n or 1)
        n = len(weights)
        total = self.w - gap * (n - 1)
        s = float(sum(weights))
        out, x = [], self.x
        for wt in weights:
            cw = total * wt / s
            out.append(R(x, self.y, cw, self.h))
            x += cw + gap
        return out

    def rows(self, n=None, gap=8, weights=None):
        weights = weights or [1] * (n or 1)
        n = len(weights)
        total = self.h - gap * (n - 1)
        s = float(sum(weights))
        out, y = [], self.y
        for wt in weights:
            rh = total * wt / s
            out.append(R(self.x, y, self.w, rh))
            y += rh + gap
        return out

    def grid(self, nrows, ncols, gx=8, gy=8):
        return [c for row in self.rows(nrows, gy) for c in row.cols(ncols, gx)]

    def pad_h(self, p):
        return R(self.x + p, self.y, self.w - 2 * p, self.h)

    def band(self, y, h):
        """Sub-rect at absolute offset `y` from own top."""
        return R(self.x, self.y + y, self.w, h)


def f(v):
    """Compact float formatting for SVG output."""
    return ("%.2f" % float(v)).rstrip("0").rstrip(".")


# ──────────────────────────────────────────────────────────────────── atoms ──


def text(x, y, s, *, fs=10, weight=400, fill="#0f172a", anchor="start",
         family=None, ls=None, style=None, opacity=None):
    a = f'x="{f(x)}" y="{f(y)}" font-size="{f(fs)}" font-weight="{weight}" fill="{fill}"'
    if anchor != "start":
        a += f' text-anchor="{anchor}"'
    if family:
        a += f' font-family="{family}"'
    if ls is not None:
        a += f' letter-spacing="{f(ls)}"'
    if style:
        a += f' font-style="{style}"'
    if opacity is not None:
        a += f' opacity="{f(opacity)}"'
    return f"<text {a}>{esc(s)}</text>"


def block(r, lines_spec, *, anchor="middle", pad=5, valign="middle"):
    """
    Render a vertically-centred stack of wrapped text lines inside `r`.
    lines_spec: list of dicts {text, fs, weight, fill, lh(optional), gap(before),
                               family, ls, style, max_lines}
    """
    iw = r.w - 2 * pad
    resolved = []
    total = 0.0
    for i, sp in enumerate(lines_spec):
        if not sp.get("text"):
            continue
        fs = sp.get("fs", 10)
        ml = sp.get("max_lines", 4)
        ls_ = wrap(sp["text"], fs, iw, ml)
        if not ls_:
            continue
        lh = sp.get("lh", fs * 1.22)
        gap = sp.get("gap", 2.2) if resolved else 0.0
        resolved.append((sp, ls_, lh, gap))
        total += gap + lh * len(ls_)

    if valign == "top":
        cur = r.y + pad
    else:
        cur = r.y + (r.h - total) / 2
    ax = r.cx if anchor == "middle" else (r.x + pad if anchor == "start" else r.x2 - pad)

    out = []
    for sp, ls_, lh, gap in resolved:
        cur += gap
        for ln in ls_:
            out.append(text(ax, cur + lh * 0.78, ln,
                            fs=sp.get("fs", 10), weight=sp.get("weight", 400),
                            fill=sp.get("fill", "#0f172a"), anchor=anchor,
                            family=sp.get("family"), ls=sp.get("ls"),
                            style=sp.get("style")))
            cur += lh
    return "".join(out)


def rect(r, *, fill="#fff", stroke="#94a3b8", sw=1.2, rx=7, dash=None,
         opacity=None, filter=None):
    a = (f'x="{f(r.x)}" y="{f(r.y)}" width="{f(r.w)}" height="{f(r.h)}" '
         f'rx="{f(rx)}" fill="{fill}" stroke="{stroke}" stroke-width="{f(sw)}"')
    if dash:
        a += f' stroke-dasharray="{dash}"'
    if opacity is not None:
        a += f' opacity="{f(opacity)}"'
    if filter:
        a += f' filter="url(#{filter})"'
    return f"<rect {a}/>"


def box(r, title=None, sub=None, *, fill="#fff", stroke="#94a3b8", sw=1.2, rx=7,
        tfs=12.4, sfs=9.5, tcol="#0f172a", scol="#54637a", tweight=700,
        stereo=None, stfs=8.6, stcol="#7c8ba1", dash=None, pad=6,
        title_lines=2, sub_lines=3, sub2=None, s2fs=8.8, s2col="#7c8ba1",
        mono_sub=False, anchor="middle", valign="middle"):
    spec = []
    if stereo:
        spec.append({"text": f"«{stereo}»", "fs": stfs, "weight": 600,
                     "fill": stcol, "max_lines": 1, "gap": 0})
    if title:
        spec.append({"text": title, "fs": tfs, "weight": tweight, "fill": tcol,
                     "max_lines": title_lines, "gap": 2.0})
    if sub:
        spec.append({"text": sub, "fs": sfs, "weight": 400, "fill": scol,
                     "max_lines": sub_lines, "gap": 2.8,
                     "family": "Cascadia Code, Consolas, monospace" if mono_sub else None})
    if sub2:
        spec.append({"text": sub2, "fs": s2fs, "weight": 600, "fill": s2col,
                     "max_lines": 2, "gap": 2.4})
    return (rect(r, fill=fill, stroke=stroke, sw=sw, rx=rx, dash=dash)
            + block(r, spec, pad=pad, anchor=anchor, valign=valign))


def container(r, label, *, fill="#f8fafc", stroke="#cbd5e1", sw=1.3, rx=12,
              dash=None, lcol="#334155", lfs=11.2, lls=0.9, tag=None,
              tagfill=None, pad=11):
    """A labelled grouping frame; returns (svg, inner_rect).

    The label and the optional right-hand tag are auto-shrunk so they can never
    collide with each other, however long the caption is.
    """
    out = [rect(r, fill=fill, stroke=stroke, sw=sw, rx=rx, dash=dash)]

    tfs, twd = 8.4, 0.0
    if tag:
        budget = r.w - 2 * pad - tw(label, 8.6) - 16      # keep the label legible
        while tfs > 6.6 and tw(tag, tfs) + 14 > budget:
            tfs -= 0.2
        twd = tw(tag, tfs) + 14

    avail = r.w - 2 * pad - (twd + 10 if tag else 0)
    while lfs > 8.2 and tw(label, lfs) + tw(" ", lfs) * lls * len(str(label)) > avail:
        lfs -= 0.2
    ly = r.y + lfs + 4.5
    out.append(text(r.x + pad, ly, label, fs=lfs, weight=700, fill=lcol, ls=lls))

    if tag:
        out.append(rect(R(r.x2 - pad - twd, r.y + 5.5, twd, 14.5),
                        fill=tagfill or "#e2e8f0", stroke="none", rx=7))
        out.append(text(r.x2 - pad - twd / 2, r.y + 15.6, tag, fs=tfs,
                        weight=700, fill=lcol, anchor="middle", ls=0.5))

    inner = R(r.x + pad, ly + 5, r.w - 2 * pad, r.h - (ly + 5 - r.y) - pad)
    return "".join(out), inner


# ─────────────────────────────────────────────────────────────────── arrows ──


def arrow(x1, y1, x2, y2, *, stroke="#475569", sw=1.5, dash=None, head="a",
          label=None, lfs=8.6, lcol=None, lside=0, curve=None, tail=None):
    if curve:
        mx, my = (x1 + x2) / 2 + curve[0], (y1 + y2) / 2 + curve[1]
        d = f"M{f(x1)},{f(y1)} Q{f(mx)},{f(my)} {f(x2)},{f(y2)}"
    else:
        d = f"M{f(x1)},{f(y1)} L{f(x2)},{f(y2)}"
    a = f'd="{d}" fill="none" stroke="{stroke}" stroke-width="{f(sw)}"'
    if dash:
        a += f' stroke-dasharray="{dash}"'
    if head:
        a += f' marker-end="url(#{head})"'
    if tail:
        a += f' marker-start="url(#{tail})"'
    out = [f"<path {a}/>"]
    if label:
        lx, ly = (x1 + x2) / 2, (y1 + y2) / 2
        wd = tw(label, lfs) + 8
        out.append(rect(R(lx - wd / 2, ly - lfs * 0.78 + lside, wd, lfs * 1.5),
                        fill="#ffffff", stroke="none", rx=4, opacity=0.92))
        out.append(text(lx, ly + lfs * 0.36 + lside, label, fs=lfs, weight=600,
                        fill=lcol or stroke, anchor="middle"))
    return "".join(out)


def elbow(x1, y1, x2, y2, *, mid=None, vfirst=False, stroke="#475569", sw=1.5,
          dash=None, head="a", label=None, lfs=8.6, lcol=None):
    if vfirst:
        m = mid if mid is not None else (y1 + y2) / 2
        d = f"M{f(x1)},{f(y1)} L{f(x1)},{f(m)} L{f(x2)},{f(m)} L{f(x2)},{f(y2)}"
    else:
        m = mid if mid is not None else (x1 + x2) / 2
        d = f"M{f(x1)},{f(y1)} L{f(m)},{f(y1)} L{f(m)},{f(y2)} L{f(x2)},{f(y2)}"
    a = f'd="{d}" fill="none" stroke="{stroke}" stroke-width="{f(sw)}"'
    if dash:
        a += f' stroke-dasharray="{dash}"'
    if head:
        a += f' marker-end="url(#{head})"'
    out = [f"<path {a}/>"]
    if label:
        if vfirst:
            lx, ly = (x1 + x2) / 2, m
        else:
            lx, ly = m, (y1 + y2) / 2
        wd = tw(label, lfs) + 8
        out.append(rect(R(lx - wd / 2, ly - lfs * 0.8, wd, lfs * 1.55),
                        fill="#ffffff", stroke="none", rx=4, opacity=0.93))
        out.append(text(lx, ly + lfs * 0.34, label, fs=lfs, weight=600,
                        fill=lcol or stroke, anchor="middle"))
    return "".join(out)


def line(x1, y1, x2, y2, *, stroke="#94a3b8", sw=1.2, dash=None, opacity=None):
    a = (f'x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2)}" '
         f'stroke="{stroke}" stroke-width="{f(sw)}"')
    if dash:
        a += f' stroke-dasharray="{dash}"'
    if opacity is not None:
        a += f' opacity="{f(opacity)}"'
    return f"<line {a}/>"


# ──────────────────────────────────────────────────────── UML-shaped atoms ──


def oval(r, label, *, fs=9.8, fill="#fff", stroke="#7c3aed", sw=1.3,
         fillcol="#3b0764", weight=600, max_lines=3):
    out = [f'<ellipse cx="{f(r.cx)}" cy="{f(r.cy)}" rx="{f(r.w / 2)}" '
           f'ry="{f(r.h / 2)}" fill="{fill}" stroke="{stroke}" stroke-width="{f(sw)}"/>']
    out.append(block(r.inset(all=r.h * 0.14),
                     [{"text": label, "fs": fs, "weight": weight, "fill": fillcol,
                       "max_lines": max_lines, "lh": fs * 1.13}], pad=3))
    return "".join(out)


def actor(cx, cy, label, *, col="#0f172a", s=1.0, fs=9.4, below=True,
          sub=None, sfs=8.2, scol="#64748b"):
    hr = 5.2 * s
    out = [f'<circle cx="{f(cx)}" cy="{f(cy - 13 * s)}" r="{f(hr)}" fill="none" '
           f'stroke="{col}" stroke-width="{f(1.5 * s)}"/>']
    out.append(f'<path d="M{f(cx)},{f(cy - 7.6 * s)} L{f(cx)},{f(cy + 5 * s)} '
               f'M{f(cx - 8 * s)},{f(cy - 3 * s)} L{f(cx + 8 * s)},{f(cy - 3 * s)} '
               f'M{f(cx)},{f(cy + 5 * s)} L{f(cx - 7 * s)},{f(cy + 16 * s)} '
               f'M{f(cx)},{f(cy + 5 * s)} L{f(cx + 7 * s)},{f(cy + 16 * s)}" '
               f'fill="none" stroke="{col}" stroke-width="{f(1.5 * s)}" stroke-linecap="round"/>')
    ly = cy + 27 * s if below else cy - 26 * s
    for i, ln in enumerate(wrap(label, fs, 92, 2)):
        out.append(text(cx, ly + i * fs * 1.15, ln, fs=fs, weight=700, fill=col,
                        anchor="middle"))
    if sub:
        out.append(text(cx, ly + len(wrap(label, fs, 92, 2)) * fs * 1.15 + 1.5,
                        sub, fs=sfs, weight=500, fill=scol, anchor="middle"))
    return "".join(out)


def note(r, lines, *, fs=8.8, fill="#fffbeb", stroke="#f59e0b", tcol="#78350f",
         fold=11, title=None, tfs=9.4, anchor="start"):
    d = (f"M{f(r.x)},{f(r.y)} H{f(r.x2 - fold)} L{f(r.x2)},{f(r.y + fold)} "
         f"V{f(r.y2)} H{f(r.x)} Z")
    out = [f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="1.1"/>',
           f'<path d="M{f(r.x2 - fold)},{f(r.y)} V{f(r.y + fold)} H{f(r.x2)}" '
           f'fill="none" stroke="{stroke}" stroke-width="1.1"/>']
    spec = []
    if title:
        spec.append({"text": title, "fs": tfs, "weight": 700, "fill": tcol,
                     "max_lines": 2, "gap": 0})
    for ln in (lines if isinstance(lines, (list, tuple)) else [lines]):
        spec.append({"text": ln, "fs": fs, "weight": 400, "fill": tcol,
                     "max_lines": 3, "gap": 2.0})
    out.append(block(r.inset(all=6), spec, pad=2, anchor=anchor,
                     valign="middle"))
    return "".join(out)


def cyl(r, title, sub=None, *, fill="#fff", stroke="#0891b2", tcol="#0f172a",
        scol="#54637a", tfs=11.4, sfs=8.9, e=9):
    d = (f"M{f(r.x)},{f(r.y + e)} A{f(r.w / 2)},{f(e)} 0 0 1 {f(r.x2)},{f(r.y + e)} "
         f"V{f(r.y2 - e)} A{f(r.w / 2)},{f(e)} 0 0 1 {f(r.x)},{f(r.y2 - e)} Z")
    out = [f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="1.3"/>',
           f'<path d="M{f(r.x)},{f(r.y + e)} A{f(r.w / 2)},{f(e)} 0 0 0 {f(r.x2)},{f(r.y + e)}" '
           f'fill="none" stroke="{stroke}" stroke-width="1.1"/>']
    spec = [{"text": title, "fs": tfs, "weight": 700, "fill": tcol, "max_lines": 2}]
    if sub:
        spec.append({"text": sub, "fs": sfs, "weight": 400, "fill": scol,
                     "max_lines": 3, "gap": 2.2})
    out.append(block(R(r.x, r.y + e, r.w, r.h - e), spec, pad=6))
    return "".join(out)


def node3d(r, title, sub=None, *, stereo="device", d=9, fill="#fff",
           top="#e2e8f0", stroke="#475569", tfs=11.2, sfs=8.8,
           tcol="#0f172a", scol="#54637a"):
    """UML deployment node: box with 3-D top/side faces."""
    out = [f'<path d="M{f(r.x)},{f(r.y)} L{f(r.x + d)},{f(r.y - d)} '
           f'L{f(r.x2 + d)},{f(r.y - d)} L{f(r.x2)},{f(r.y)} Z" fill="{top}" '
           f'stroke="{stroke}" stroke-width="1.1"/>',
           f'<path d="M{f(r.x2)},{f(r.y)} L{f(r.x2 + d)},{f(r.y - d)} '
           f'L{f(r.x2 + d)},{f(r.y2 - d)} L{f(r.x2)},{f(r.y2)} Z" fill="{top}" '
           f'stroke="{stroke}" stroke-width="1.1" opacity="0.72"/>',
           rect(r, fill=fill, stroke=stroke, sw=1.25, rx=2)]
    spec = []
    if stereo:
        spec.append({"text": f"«{stereo}»", "fs": 8.2, "weight": 600,
                     "fill": "#7c8ba1", "max_lines": 1})
    spec.append({"text": title, "fs": tfs, "weight": 700, "fill": tcol,
                 "max_lines": 2, "gap": 1.6})
    if sub:
        spec.append({"text": sub, "fs": sfs, "weight": 400, "fill": scol,
                     "max_lines": 3, "gap": 2.2})
    out.append(block(r, spec, pad=6))
    return "".join(out)


def pkg(r, title, sub=None, *, tabw=0.46, tabh=15, fill="#fff",
        stroke="#6366f1", tcol="#0f172a", scol="#54637a", tfs=10.8, sfs=8.6,
        tabfill=None):
    tw_ = r.w * tabw
    out = [rect(R(r.x, r.y, tw_, tabh), fill=tabfill or "#e0e7ff", stroke=stroke,
                sw=1.15, rx=3),
           rect(R(r.x, r.y + tabh - 1, r.w, r.h - tabh + 1), fill=fill,
                stroke=stroke, sw=1.25, rx=3)]
    spec = [{"text": title, "fs": tfs, "weight": 700, "fill": tcol, "max_lines": 2}]
    if sub:
        spec.append({"text": sub, "fs": sfs, "weight": 400, "fill": scol,
                     "max_lines": 4, "gap": 2.2})
    out.append(block(R(r.x, r.y + tabh, r.w, r.h - tabh), spec, pad=5))
    return "".join(out)


def comp(r, title, sub=None, *, fill="#fff", stroke="#0e7490", tcol="#0f172a",
         scol="#54637a", tfs=10.8, sfs=8.6, stereo="component"):
    out = [rect(r, fill=fill, stroke=stroke, sw=1.3, rx=4)]
    for i in (0, 1):
        ty = r.y + 9 + i * 15
        out.append(rect(R(r.x - 5, ty, 14, 9), fill="#fff", stroke=stroke, sw=1.1, rx=1.5))
    spec = []
    if stereo:
        spec.append({"text": f"«{stereo}»", "fs": 8.0, "weight": 600,
                     "fill": "#7c8ba1", "max_lines": 1})
    spec.append({"text": title, "fs": tfs, "weight": 700, "fill": tcol,
                 "max_lines": 2, "gap": 1.4})
    if sub:
        spec.append({"text": sub, "fs": sfs, "weight": 400, "fill": scol,
                     "max_lines": 3, "gap": 2.0})
    out.append(block(R(r.x + 8, r.y, r.w - 10, r.h), spec, pad=5))
    return "".join(out)


def uml_class(r, name, attrs, ops=None, *, stereo=None, fill="#fff",
              head="#e0e7ff", stroke="#6366f1", nfs=10.6, afs=9.3,
              ncol="#312e81", acol="#334155", pad=5, lh=None, italic_name=False,
              hug=False):
    """UML class box: name compartment + attribute compartment (+ operations).

    Attribute type size and line height are shrunk automatically if the listed
    members would not otherwise fit inside `r`, so a compartment can never be
    clipped by its own frame.  Any space left over is split above and below the
    body; with `hug=True` the frame itself shrinks to the content instead and is
    centred in `r`.
    """
    attrs = attrs or []
    ops = ops or []
    headh = nfs * 1.30 + (9 if stereo else 0) + 7
    lh0 = lh or afs * 1.30

    def need(a_fs, a_lh):
        n = 0
        for a in attrs:
            n += len(wrap(a, a_fs, r.w - 2 * pad, 1))
        rows = n
        extra = 0.0
        if ops:
            extra = 5.5 + 1
            for o_ in ops:
                rows += len(wrap(o_, a_fs, r.w - 2 * pad, 1))
        return headh + 4.5 + rows * a_lh + extra + 3

    lh = lh0
    while (afs > 6.4) and need(afs, lh) > r.h:
        afs -= 0.15
        lh = max(afs * 1.14, lh - 0.22)

    # whatever slack is left goes above and below the body, not all below
    slack = max(0.0, r.h - need(afs, lh))
    if hug and slack > 0:
        # shrink the frame to its content and centre it in the space allotted;
        # only safe for boxes no connector attaches to by top or bottom edge
        r = R(r.x, r.y + slack / 2, r.w, r.h - slack)
        slack = 0.0

    out = [rect(r, fill=fill, stroke=stroke, sw=1.25, rx=4),
           rect(R(r.x + 0.7, r.y + 0.7, r.w - 1.4, headh - 1.4), fill=head,
                stroke="none", rx=3.4, opacity=0.6),
           f'<path d="M{f(r.x)},{f(r.y + headh)} H{f(r.x2)}" stroke="{stroke}" '
           f'stroke-width="1.1"/>']
    cy = r.y + 4
    if stereo:
        out.append(text(r.cx, cy + 7.4, f"\u00ab{stereo}\u00bb", fs=7.9, weight=600,
                        fill="#64748b", anchor="middle"))
        cy += 9
    out.append(text(r.cx, cy + nfs * 1.0, name, fs=nfs, weight=800, fill=ncol,
                    anchor="middle", style="italic" if italic_name else None))
    y = r.y + headh + 4.5 + slack * 0.5
    for a in attrs:
        for ln in wrap(a, afs, r.w - 2 * pad, 1):
            out.append(text(r.x + pad, y + afs * 0.82, ln, fs=afs, weight=400,
                            fill=acol))
            y += lh
    if ops:
        out.append(f'<path d="M{f(r.x)},{f(y + 1)} H{f(r.x2)}" stroke="{stroke}" '
                   f'stroke-width="1.0" stroke-dasharray="3 2.5"/>')
        y += 5.5
        for o in ops:
            for ln in wrap(o, afs, r.w - 2 * pad, 1):
                out.append(text(r.x + pad, y + afs * 0.82, ln, fs=afs, weight=600,
                                fill="#0e7490"))
                y += lh
    return "".join(out)


def state(r, label, sub=None, *, fill="#fff", stroke="#e11d48", tcol="#881337",
          tfs=11.0, sfs=8.4, rx=None, final=False, initial=False):
    rx = rx if rx is not None else r.h / 2
    out = [rect(r, fill=fill, stroke=stroke, sw=1.5, rx=min(rx, 16))]
    if final:
        out.insert(0, rect(r.inset(all=-3.2), fill="none", stroke=stroke, sw=1.0,
                           rx=min(rx + 3, 19)))
    spec = [{"text": label, "fs": tfs, "weight": 700, "fill": tcol, "max_lines": 2}]
    if sub:
        spec.append({"text": sub, "fs": sfs, "weight": 400, "fill": "#9f1239",
                     "max_lines": 2, "gap": 1.8})
    out.append(block(r, spec, pad=6))
    return "".join(out)


def chip(x, y, label, *, fs=8.4, fill="#eef2ff", col="#3730a3", h=15.5, pad=7,
         rx=7.5, stroke=None, weight=600):
    w = tw(label, fs) + pad * 2
    out = [rect(R(x, y, w, h), fill=fill, stroke=stroke or "none",
                sw=0.9 if stroke else 0, rx=rx)]
    out.append(text(x + w / 2, y + h * 0.5 + fs * 0.36, label, fs=fs,
                    weight=weight, fill=col, anchor="middle"))
    return "".join(out), w


def chiprow(r, labels, *, fs=8.4, fill="#eef2ff", col="#3730a3", h=15.5,
            gap=4.5, vgap=4.0, stroke=None):
    """Flow-wrap chips inside r. Returns (svg, used_height)."""
    out, x, y, maxx = [], r.x, r.y, r.x2
    for lb in labels:
        w = tw(lb, fs) + 14
        if x + w > maxx and x > r.x:
            x = r.x
            y += h + vgap
        s, w = chip(x, y, lb, fs=fs, fill=fill, col=col, h=h, stroke=stroke)
        out.append(s)
        x += w + gap
    return "".join(out), (y + h) - r.y


def badge(r, num, *, fill="#6366f1", col="#fff", fs=10.5, rx=6):
    return (rect(r, fill=fill, stroke="none", rx=rx)
            + text(r.cx, r.cy + fs * 0.36, num, fs=fs, weight=800, fill=col,
                   anchor="middle"))


# ───────────────────────────────────────────────────────────── svg document ──

_MARKERS = [
    ("a", "#475569"), ("ab", "#2563eb"), ("ao", "#ea580c"), ("ag", "#16a34a"),
    ("ap", "#7c3aed"), ("ar", "#e11d48"), ("ai", "#4f46e5"), ("ac", "#0891b2"),
    ("am", "#d97706"), ("as", "#94a3b8"), ("ate", "#0f766e"), ("av", "#8b5cf6"),
]


def _defs():
    out = ["<defs>"]
    for name, col in _MARKERS:
        out.append(
            f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">'
            f'<path d="M0,1.2 L9.4,5 L0,8.8 z" fill="{col}"/></marker>')
        out.append(
            f'<marker id="{name}o" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0.6,1.4 L9.2,5 L0.6,8.6" fill="none" stroke="{col}" '
            f'stroke-width="1.5"/></marker>')
        out.append(
            f'<marker id="{name}d" viewBox="0 0 12 12" refX="11" refY="6" '
            f'markerWidth="8" markerHeight="8" orient="auto-start-reverse">'
            f'<path d="M0.5,6 L5.5,2.4 L11,6 L5.5,9.6 z" fill="#fff" '
            f'stroke="{col}" stroke-width="1.2"/></marker>')
        out.append(
            f'<marker id="{name}f" viewBox="0 0 12 12" refX="11" refY="6" '
            f'markerWidth="8" markerHeight="8" orient="auto-start-reverse">'
            f'<path d="M0.5,6 L5.5,2.4 L11,6 L5.5,9.6 z" fill="{col}" '
            f'stroke="{col}" stroke-width="1"/></marker>')
        out.append(
            f'<marker id="{name}t" viewBox="0 0 12 12" refX="11" refY="6" '
            f'markerWidth="9" markerHeight="9" orient="auto-start-reverse">'
            f'<path d="M1,1.5 L11,6 L1,10.5 z" fill="#fff" stroke="{col}" '
            f'stroke-width="1.2"/></marker>')
    out.append('<marker id="dot" viewBox="0 0 8 8" refX="4" refY="4" '
               'markerWidth="4.5" markerHeight="4.5"><circle cx="4" cy="4" r="3.2" '
               'fill="#475569"/></marker>')
    out.append("</defs>")
    return "".join(out)


DEFS = _defs()

_BASE_STYLE = (
    "text{font-family:'Times New Roman',Times,serif;"
    "dominant-baseline:auto;white-space:pre}"
)


def svg(vw, vh, body, *, style="", aspect=None):
    """
    `aspect` = desired height/width of the *container*. The viewBox is padded
    (never cropped) so the drawing exactly fills that container and stays
    centred — which keeps every diagram at full page width.
    """
    ox = oy = 0.0
    W, H = float(vw), float(vh)
    if aspect:
        need_w = vh / float(aspect)
        if need_w >= vw:
            ox = -(need_w - vw) / 2.0
            W = need_w
        else:
            need_h = vw * float(aspect)
            oy = -(need_h - vh) / 2.0
            H = need_h
    return (f'<svg viewBox="{f(ox)} {f(oy)} {f(W)} {f(H)}" '
            f'preserveAspectRatio="xMidYMid meet" '
            f'xmlns="http://www.w3.org/2000/svg" role="img">'
            f"{DEFS}<style>{_BASE_STYLE}{style}</style>{body}</svg>")


def polyline(points, *, stroke="#94a3b8", sw=1.2, dash=None, head=None):
    d = " ".join(f"{'M' if i == 0 else 'L'}{f(x)},{f(y)}"
                 for i, (x, y) in enumerate(points))
    a = f'd="{d}" fill="none" stroke="{stroke}" stroke-width="{f(sw)}"'
    if dash:
        a += f' stroke-dasharray="{dash}"'
    if head:
        a += f' marker-end="url(#{head})"'
    return f"<path {a}/>"
