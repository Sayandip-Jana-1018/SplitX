"""Page shell + CSS for the SplitX synopsis (A4, 10 content pages)."""

# Per-page colour families: c0 deep, c1 mid, c2 light, c3 wash, grad
THEMES = {
    "teal":   ("#0f766e", "#14b8a6", "#99f6e4", "#f0fdfa", "#0d9488", "#2dd4bf"),
    "blue":   ("#1e40af", "#3b82f6", "#bfdbfe", "#eff6ff", "#1d4ed8", "#60a5fa"),
    "orange": ("#c2410c", "#f97316", "#fed7aa", "#fff7ed", "#ea580c", "#fb923c"),
    "amber":  ("#b45309", "#f59e0b", "#fde68a", "#fffbeb", "#d97706", "#ef4444"),
    "green":  ("#15803d", "#22c55e", "#bbf7d0", "#f0fdf4", "#16a34a", "#4ade80"),
    "purple": ("#7e22ce", "#a855f7", "#e9d5ff", "#faf5ff", "#9333ea", "#c084fc"),
    "indigo": ("#3730a3", "#6366f1", "#c7d2fe", "#eef2ff", "#4f46e5", "#818cf8"),
    "violet": ("#6b21a8", "#8b5cf6", "#ddd6fe", "#f5f3ff", "#7c3aed", "#a78bfa"),
    "rose":   ("#9f1239", "#f43f5e", "#fecdd3", "#fff1f2", "#e11d48", "#fb7185"),
    "cyan":   ("#155e75", "#06b6d4", "#a5f3fc", "#ecfeff", "#0891b2", "#22d3ee"),
}


def _theme_css():
    out = []
    for name, (c0, c1, c2, c3, g1, g2) in THEMES.items():
        out.append(
            f".t-{name}{{--c0:{c0};--c1:{c1};--c2:{c2};--c3:{c3};"
            f"--grad:linear-gradient(120deg,{g1},{g2})}}")
    return "".join(out)


CSS = """
@page { size: A4; margin: 0; }

* { margin:0; padding:0; box-sizing:border-box; }

html, body { background:#fff; }

body {
  font-family:'Times New Roman', Times, serif;
  color:#0f172a;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
  text-rendering:geometricPrecision;
}

.page {
  position:relative;
  width:210mm; height:297mm;
  padding:8.0mm 11mm 7.2mm;
  display:flex; flex-direction:column;
  overflow:hidden;
  page-break-after:always; break-after:page;
  background:#fff;
}
.page:last-child { page-break-after:auto; break-after:auto; }

/* thin coloured spine down the left edge of every page */
.page::before{
  content:''; position:absolute; left:0; top:0; bottom:0; width:3.1mm;
  background:var(--grad);
}

/* ── signature strip, sits above the page heading ── */
.sig{
  flex:0 0 auto; display:flex; align-items:center; justify-content:center;
  gap:4.5px; margin-bottom:2.0mm;
  font-size:8.2pt; font-style:italic; font-weight:400;
  color:#94a3b8; letter-spacing:.015em; line-height:1;
}
.sig b{ font-style:normal; font-weight:700; color:var(--c0); letter-spacing:.01em; }
.sig svg{ width:9px; height:9px; flex:0 0 auto; display:block; }
.sig .rule{ flex:0 0 auto; width:16px; height:1px; background:var(--c2); }

/* ── header ── */
.phead{
  flex:0 0 auto; display:flex; align-items:center; gap:8px;
  padding-bottom:5px; margin-bottom:4.2mm;
  border-bottom:2.4px solid var(--c1);
}
.pnum{
  flex:0 0 auto; width:23px; height:23px; border-radius:7px;
  background:var(--grad); color:#fff;
  font-size:11.5px; font-weight:800; line-height:23px; text-align:center;
  letter-spacing:-.02em;
}
.ptitle{ font-size:15.6px; font-weight:800; letter-spacing:-.025em; color:var(--c0); }
.pkind{
  font-size:9px; font-weight:700; color:var(--c0);
  letter-spacing:.1em; text-transform:uppercase;
  background:var(--c3); border:1px solid var(--c2);
  padding:2.5px 8px; border-radius:100px; margin-left:auto; white-space:nowrap;
}

/* ── body ── */
.pbody{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:3.6mm; }
.pbody.spread{ justify-content:space-between; }
.fig{ flex:0 0 auto; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.fig > svg{ width:100%; height:100%; display:block; }

.figcap{
  flex:0 0 auto; text-align:center; font-size:8.4pt; font-weight:600;
  color:#64748b; letter-spacing:.01em; padding-top:1.1mm; line-height:1.35;
}
.figcap b{ color:var(--c0); font-weight:800; }

.figrow{ flex:0 0 auto; min-height:0; display:flex; gap:3.4mm; align-items:stretch; }
.figrow > *{ flex:1 1 0; min-width:0; min-height:0; height:100%; }
.figrow > .fig{ display:flex; align-items:center; justify-content:center; overflow:hidden; }

/* ── footer ── */
.pfoot{
  flex:0 0 auto; margin-top:2.6mm; padding-top:3.5px;
  border-top:1px solid #e6ebf1;
  display:flex; align-items:center; justify-content:space-between;
  font-size:7.4pt; color:#98a3b3; font-weight:500;
}
.pfoot .fl{ font-weight:700; color:var(--c0); letter-spacing:.02em; }
.pfoot .fr{ font-weight:700; color:#64748b; }
.pfoot .cr{
  font-weight:700; color:#475569; letter-spacing:.02em; white-space:nowrap;
}
.pfoot .cr i{
  font-style:normal; font-size:9.4pt; font-weight:400; color:var(--c0);
  vertical-align:-.055em; margin-right:1.5px;
}

/* ── page 1 pieces ── */
.hero{
  flex:0 0 auto; border-radius:11px; padding:4.2mm 5.4mm;
  background:var(--grad); color:#fff; position:relative; overflow:hidden;
}
.hero h1{ font-size:28px; font-weight:900; letter-spacing:-.035em; line-height:1; }
.hero .tag{ font-size:9.8pt; font-weight:500; opacity:.95; margin-top:1.6mm; line-height:1.34; max-width:158mm; }
.hero .hchips{ display:flex; flex-wrap:wrap; gap:3.5px; margin-top:2.6mm; }
.hero .hchips span{
  font-size:7.2pt; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  background:rgba(255,255,255,.2); border:1px solid rgba(255,255,255,.34);
  padding:2.1px 7px; border-radius:100px;
}

.cards{ flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr; gap:2.6mm; }
.card{
  border:1px solid #e2e8f0; border-left:3.2px solid var(--ac,#94a3b8);
  border-radius:9px; padding:2.5mm 3.1mm; background:#fff;
}
.card h3{
  font-size:9.6pt; font-weight:800; color:var(--ac,#334155);
  letter-spacing:-.01em; margin-bottom:1.2mm;
  display:flex; align-items:center; gap:5px;
}
.card h3 i{
  width:14px; height:14px; border-radius:4.5px; background:var(--ac,#94a3b8);
  color:#fff; font-style:normal; font-size:7.6pt; font-weight:800;
  line-height:14px; text-align:center; flex:0 0 auto;
}
.card p{ font-size:8.0pt; line-height:1.40; color:#3f4c60; text-align:justify; }
.card ul{ list-style:none; }
.card li{
  font-size:7.9pt; line-height:1.34; color:#3f4c60;
  padding-left:8px; position:relative; margin-bottom:.75mm;
}
.card li::before{
  content:''; position:absolute; left:0; top:4px;
  width:3.6px; height:3.6px; border-radius:50%; background:var(--ac,#94a3b8);
}
.card li b{ color:#111a2b; font-weight:700; }
.card p b{ color:#111a2b; font-weight:700; }

.stackbox{ flex:0 0 auto; border:1px solid #e2e8f0; border-radius:9px; padding:2.3mm 3mm; }
.stackbox .sbt{
  font-size:8pt; font-weight:800; color:var(--c0); letter-spacing:.09em;
  text-transform:uppercase; margin-bottom:1.5mm;
}
.srow{ display:flex; align-items:flex-start; gap:2.6mm; margin-bottom:1.2mm; }
.srow:last-child{ margin-bottom:0; }
.srow .sk{
  flex:0 0 27mm; font-size:7.6pt; font-weight:800; color:#475569; padding-top:.6mm;
}
.srow .sv{ flex:1 1 auto; display:flex; flex-wrap:wrap; gap:2.8px; }
.srow .sv span{
  font-size:7.2pt; font-weight:600; color:#334155;
  background:#f1f5f9; border:1px solid #e2e8f0;
  padding:1.4px 5.5px; border-radius:5px; white-space:nowrap;
}

.stats{ flex:0 0 auto; display:grid; grid-template-columns:repeat(6,1fr); gap:2.2mm; }
.stat{
  border-radius:8px; padding:2.1mm 1.2mm; text-align:center;
  background:var(--c3); border:1px solid var(--c2);
}
.stat b{ display:block; font-size:15px; font-weight:900; color:var(--c0); letter-spacing:-.035em; line-height:1.05; }
.stat span{ display:block; font-size:6.5pt; font-weight:700; color:#64748b; letter-spacing:.02em; margin-top:.7mm; line-height:1.22; }

/* ── generic tables ── */
table.tm{ width:100%; border-collapse:collapse; table-layout:fixed; }
table.tm th{
  background:var(--c0); color:#fff; font-size:6.9pt; font-weight:700;
  letter-spacing:.06em; text-transform:uppercase;
  padding:2.6px 6px; text-align:left;
}
table.tm th:first-child{ border-radius:5px 0 0 0; }
table.tm th:last-child{ border-radius:0 5px 0 0; }
table.tm td{
  font-size:7.2pt; padding:2.1px 6px; border-bottom:1px solid #edf1f6;
  color:#3f4c60; line-height:1.26; vertical-align:top;
}
table.tm tr:nth-child(even) td{ background:#fafcfe; }
table.tm col.w1{ width:34%; }
table.tm col.w2{ width:66%; }

/* tool matrix: name over category, role wraps */
table.tm.tools td.k{ padding-right:4px; }
table.tm.tools td.k b{ display:block; font-size:7.3pt; font-weight:800; color:#111a2b; line-height:1.2; }
table.tm.tools td.k i{
  display:block; font-style:normal; font-size:6.2pt; font-weight:700;
  color:var(--c0); letter-spacing:.045em; text-transform:uppercase;
  line-height:1.2; margin-top:.15mm;
}
table.tm.tools td.r{ font-size:6.9pt; line-height:1.3; }

.twocol{ flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr; gap:3mm; }

/* ── terminal block ── */
.term{
  background:#0b1220; border-radius:8px; padding:2.4mm 3mm;
  font-family:'Cascadia Code','Consolas','Courier New',monospace;
  font-size:6.6pt; line-height:1.46; color:#cbd5e1; overflow:hidden;
  white-space:pre;
}
.term .c{ color:#22d3ee; }
.term .g{ color:#4ade80; }
.term .y{ color:#fbbf24; }
.term .r{ color:#fb7185; }
.term .m{ color:#64748b; }
.term .w{ color:#f8fafc; font-weight:700; }
.term .t{ color:#a5b4fc; font-weight:700; }

/* ── conclusion columns ── */
.concl{ flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr 1fr; gap:2.6mm; overflow:hidden; }
.concl .cc{ border:1px solid #e2e8f0; border-top:2.8px solid var(--ac,#94a3b8); border-radius:8px; padding:2.1mm 2.6mm; overflow:hidden; }
.concl .cc h4{ font-size:8.6pt; font-weight:800; color:var(--ac,#334155); margin-bottom:1.1mm; }
.concl .cc ul{ list-style:none; }
.concl .cc li{ font-size:7.1pt; line-height:1.30; color:#3f4c60; padding-left:7px; position:relative; margin-bottom:.65mm; }
.concl .cc li::before{ content:''; position:absolute; left:0; top:3.6px; width:3.2px; height:3.2px; border-radius:50%; background:var(--ac,#94a3b8); }
.concl .cc li b{ color:#111a2b; font-weight:700; }
.concl .cc p{ font-size:7.1pt; line-height:1.34; color:#3f4c60; text-align:justify; margin-bottom:.9mm; }

/* ── two-figure page: caption under each ── */
.subhead{
  flex:0 0 auto; font-size:9.4pt; font-weight:800; color:var(--c0);
  letter-spacing:-.01em; display:flex; align-items:center; gap:6px;
}
.subhead::after{ content:''; flex:1 1 auto; height:1px; background:var(--c2); }
.subhead em{
  font-style:normal; font-size:7.2pt; font-weight:700; color:#94a3b8;
  letter-spacing:.06em; text-transform:uppercase;
}
"""


def full_css():
    return CSS + _theme_css()
