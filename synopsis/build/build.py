"""
Build SplitX_Synopsis.pdf — exactly 10 A4 content pages.

  python build.py            # render HTML + PDF + page previews + verify
  python build.py --html     # HTML only (fast iteration)
"""

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)                      # ...\synopsis
sys.path.insert(0, HERE)

import anim                                                           # noqa: E402
from theme import full_css                                            # noqa: E402
import pages_a as A                                                   # noqa: E402
import pages_b as B                                                   # noqa: E402

HTML_PATH = os.path.join(OUT, "SplitX_Synopsis_v2.html")
PDF_PATH = os.path.join(OUT, "SplitX_Synopsis.pdf")
ANIM_PATH = os.path.join(OUT, "SplitX_Synopsis_Animated.html")
PREVIEW = os.path.join(OUT, "preview")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


# ─────────────────────────────────────────────────────────── page assembly ──

def fig(svg_str, vw, vh, cap=None, grow=None, flow=False):
    """A figure that keeps its natural aspect ratio inside the flex column.

    `flow=True` marks a diagram whose arrows carry request/data flow, so the
    animated build can send travelling dots along them.
    """
    g = grow if grow is not None else round(vh / vw * 1000)
    fl = ' data-flow="1"' if flow else ""
    out = f'<div class="fig"{fl} style="flex:{g} 1 0">{svg_str}</div>'
    if cap:
        out += f'<div class="figcap">{cap}</div>'
    return out


def figrow(items, grow):
    """items: list of html strings already wrapped."""
    return (f'<div class="figrow" style="flex:{grow} 1 0">'
            + "".join(items) + "</div>")


def sub(title, kind=None):
    k = f"<em>{kind}</em>" if kind else ""
    return f'<div class="subhead">{title}{k}</div>'


HEART = ('<svg viewBox="0 0 24 24" aria-hidden="true">'
         '<path d="M12 21.2 3.9 13.1a5.3 5.3 0 0 1 0-7.5 5.3 5.3 0 0 1 7.5 0l.6.6'
         '.6-.6a5.3 5.3 0 0 1 7.5 0 5.3 5.3 0 0 1 0 7.5Z" fill="#e11d48"/></svg>')

SIGNATURE = (f'<div class="sig"><span class="rule"></span>'
             f'Built with {HEART} by <b>Sayandip</b>'
             f'<span class="rule"></span></div>')

COPYRIGHT = '<span class="cr"><i>\u00a9</i> 2026 Sayandip Jana</span>'


def page(num, title, kind, theme, body, total=10, spread=False):
    sp = " spread" if spread else ""
    return (f'<section class="page t-{theme}">'
            f"{SIGNATURE}"
            f'<div class="phead"><div class="pnum">{num}</div>'
            f'<div class="ptitle">{title}</div><div class="pkind">{kind}</div></div>'
            f'<div class="pbody{sp}">{body}</div>'
            f'<div class="pfoot"><span class="fl">SplitX &mdash; Project Synopsis</span>'
            f"{COPYRIGHT}"
            f'<span class="fr">{int(num)} / {total}</span></div>'
            f"</section>")


def build_html():
    pages = []

    # ── 01 overview ──
    pages.append(page("01", "Problem, Solution, Objectives &amp; Scope",
                      "Project Overview", "teal", A.page1_body(), spread=True))

    # ── 02 system architecture ──
    pages.append(page("02", "System Architecture", "Architecture", "blue",
                      fig(A.page2_fig(), 860, 1152,
                          "<b>Figure 1</b> &mdash; Layered system architecture: client &rarr; CDN &rarr; "
                          "ingress &rarr; Kubernetes &rarr; application runtime &rarr; data &rarr; external "
                          "services, with the cross-cutting observability plane.",
                          flow=True)))

    # ── 03 UML deployment / AWS ──
    pages.append(page("03", "Deployment Architecture on AWS", "UML Deployment Diagram",
                      "orange",
                      fig(A.page3_fig(), 860, 1160,
                          "<b>Figure 2</b> &mdash; UML deployment diagram of the Terraform-provisioned AWS "
                          "footprint: &laquo;device&raquo; and &laquo;execution environment&raquo; nodes with "
                          "the &laquo;artifact&raquo;s deployed onto them, annotated with the owning "
                          "Terraform module.")))

    # ── 04 CI/CD ──
    body = (sub("Continuous Integration &amp; Delivery Pipeline", "Jenkins &middot; on-premises")
            + fig(A.page4_fig_a(), 860, 452,
                  "<b>Figure 3</b> &mdash; Trigger chain, the twelve Jenkins stages with their four "
                  "build-failing gates, and the delivery outputs.", flow=True)
            + sub("Cloud CI/CD &amp; Keyless AWS Access", "GitHub Actions")
            + fig(A.page4_fig_b(), 860, 250,
                  "<b>Figure 4</b> &mdash; The four GitHub Actions workflows and the OIDC trust path that "
                  "removes long-lived AWS credentials entirely.")
            + sub("Toolchain Responsibilities", "Table 1")
            + A.page4_table())
    pages.append(page("04", "DevOps Toolchain &amp; CI/CD Pipeline", "Delivery Engineering",
                      "amber", body))

    # ── 05 observability + autoscaling ──
    body = (sub("Observability Data Flow", "metrics &middot; logs &middot; alerts")
            + fig(A.page5_fig_a(), 860, 364,
                  "<b>Figure 5</b> &mdash; Signal sources, collection and storage, and the consumption "
                  "surfaces; the four golden signals tracked throughout.", flow=True)
            + sub("Horizontal Pod Autoscaling &mdash; Mechanism and Measured Behaviour",
                  "Kubernetes HPA v2")
            + figrow([f'<div class="fig">{A.page5_fig_b()}</div>', A.TERM], 520)
            + fig(A.page5_fig_c(), 860, 300,
                  "<b>Figure 6</b> &mdash; The HPA reconciliation loop (left) with live "
                  "<code>kubectl</code> and k6 output (right). <b>Figure 7</b> &mdash; CPU utilisation "
                  "against ready replicas during a k6 ramp: scale-out 2&rarr;10, then scale-in after the "
                  "120&nbsp;s stabilisation window."))
    pages.append(page("05", "Observability &amp; Kubernetes Autoscaling",
                      "Operations &amp; Scaling", "green", body))

    # ── 06 use case + activity ──
    body = (sub("Use Case Diagram", "UML behavioural")
            + fig(B.page6_usecase(), 860, 520,
                  "<b>Figure 8</b> &mdash; Seventeen use cases grouped into four functional packages, "
                  "with three human roles, four system actors, and "
                  "&laquo;include&raquo;/&laquo;extend&raquo; relationships.")
            + sub("Activity Diagram &mdash; Record an Expense and Settle", "UML behavioural")
            + fig(B.page6_activity(), 860, 566,
                  "<b>Figure 9</b> &mdash; End-to-end activity flow with a three-way input decision, a "
                  "validation loop, and a fork/join for the parallel persistence, notification and "
                  "audit actions."))
    pages.append(page("06", "Use Case &amp; Activity Modelling", "UML Behavioural View",
                      "purple", body))

    # ── 07 class diagram ──
    pages.append(page("07", "Class Diagram", "UML Structural View", "indigo",
                      fig(B.page7_fig(), 860, 1152,
                          "<b>Figure 10</b> &mdash; Core domain classes with attributes, operations, "
                          "multiplicities and a composition; the stateless service classes that "
                          "implement the business rules; and the enumerated attribute domains.")))

    # ── 08 ER + package ──
    body = (sub("Entity&ndash;Relationship Diagram", "logical data model")
            + fig(B.page8_er(), 860, 676,
                  "<b>Figure 11</b> &mdash; All eighteen tables with primary keys, foreign keys, unique "
                  "constraints and indexes; one-to-many relationships are labelled 1&nbsp;&mdash;&nbsp;&infin;.")
            + sub("Package Diagram", "UML structural")
            + fig(B.page8_pkg(), 860, 424,
                  "<b>Figure 12</b> &mdash; Source packages (indigo), infrastructure-as-code packages "
                  "(orange) and delivery/observability packages (green), with "
                  "&laquo;import&raquo;/&laquo;access&raquo; dependencies."))
    pages.append(page("08", "Data Model &amp; Package Structure", "UML Structural View",
                      "violet", body))

    # ── 09 sequence + state ──
    body = (sub("Sequence Diagram &mdash; Add Expense, Compute Settlement, Pay, Approve",
                "UML behavioural")
            + fig(B.page9_seq(), 860, 682,
                  "<b>Figure 13</b> &mdash; Twenty-three time-ordered messages across eight lifelines, "
                  "with activation bars, return messages, self-messages and an "
                  "<code>alt</code> combined fragment for the rate-limit branch.")
            + sub("State Machine Diagram &mdash; Settlement Lifecycle", "UML behavioural")
            + fig(B.page9_state(), 860, 452,
                  "<b>Figure 14</b> &mdash; The six real settlement states with every permitted "
                  "transition, its triggering actor, and its guard."))
    pages.append(page("09", "Sequence &amp; State Machine", "UML Behavioural View",
                      "rose", body))

    # ── 10 component + object + communication + conclusion ──
    body = (sub("Component Diagram", "UML structural &middot; provided / required interfaces")
            + fig(B.page10_comp(), 860, 400,
                  "<b>Figure 15</b> &mdash; Components with their provided interfaces (lollipops) and "
                  "required-interface dependencies.")
            + sub("Object Diagram &amp; Communication Diagram", "UML instance and collaboration views")
            + figrow([f'<div class="fig">{B.page10_obj()}</div>',
                      f'<div class="fig">{B.page10_comm()}</div>'], 400)
            + '<div class="figcap"><b>Figure 16</b> &mdash; Object diagram: a concrete &#8377;12,000 '
              'expense split three ways, and the settlement it produces. '
              '<b>Figure 17</b> &mdash; Communication diagram: the same interaction as Figure 13, '
              'shown as numbered messages over object links.</div>'
            + B.CONCLUSION)
    pages.append(page("10", "Component, Object &amp; Communication Views &middot; Conclusion",
                      "UML + Outcomes", "cyan", body))

    body = "".join(pages)
    head = ('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            "<title>SplitX \u2014 Project Synopsis</title>")

    html = f"{head}<style>{full_css()}</style></head><body>{body}</body></html>"
    with open(HTML_PATH, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"[html] {HTML_PATH}  ({len(html) / 1024:.0f} KB, {len(pages)} pages)")

    animated = (f"{head}<style>{full_css()}{anim.CSS}</style></head><body>"
                f"{body}<script>{anim.JS}</script></body></html>")
    with open(ANIM_PATH, "w", encoding="utf-8") as fh:
        fh.write(animated)
    print(f"[anim] {ANIM_PATH}  ({len(animated) / 1024:.0f} KB, animated)")
    return len(pages)


# ────────────────────────────────────────────────────────────────── render ──

def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    for n in ("chrome", "msedge"):
        p = shutil.which(n)
        if p:
            return p
    raise SystemExit("Chrome/Edge not found — cannot render the PDF.")


def render_pdf():
    chrome = find_chrome()
    if os.path.exists(PDF_PATH):
        try:
            os.remove(PDF_PATH)
        except OSError:
            pass
    url = "file:///" + HTML_PATH.replace("\\", "/")
    cmd = [chrome, "--headless=new", "--disable-gpu", "--no-first-run",
           "--no-default-browser-check", "--disable-extensions",
           "--hide-scrollbars", "--force-device-scale-factor=1",
           "--run-all-compositor-stages-before-draw",
           "--virtual-time-budget=8000", "--no-pdf-header-footer",
           f"--print-to-pdf={PDF_PATH}", url]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    if not os.path.exists(PDF_PATH):
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
        raise SystemExit("PDF was not produced.")
    print(f"[pdf ] {PDF_PATH}  ({os.path.getsize(PDF_PATH) / 1024:.0f} KB)")


TRANSITIONS = [
    ("Wipe", 270), ("Split", None), ("Wipe", 270), ("Blinds", None),
    ("Wipe", 270), ("Fade", None), ("Wipe", 270), ("Split", None),
    ("Wipe", 270), ("Fade", None),
]


def add_transitions():
    """Attach a /Trans dictionary to every page.

    Acrobat / Adobe Reader play these when the document is shown full-screen
    (Ctrl+L); viewers that ignore /Trans simply render the pages normally, so
    this can never damage the printed artefact.
    """
    import PyPDF2
    from PyPDF2.generic import (ArrayObject, DictionaryObject, FloatObject,
                                NameObject, NumberObject)

    rd = PyPDF2.PdfReader(PDF_PATH)
    wr = PyPDF2.PdfWriter()
    for i, page in enumerate(rd.pages):
        style, direction = TRANSITIONS[i % len(TRANSITIONS)]
        trans = DictionaryObject()
        trans[NameObject("/Type")] = NameObject("/Trans")
        trans[NameObject("/S")] = NameObject("/" + style)
        trans[NameObject("/D")] = FloatObject(0.8)
        if direction is not None:
            trans[NameObject("/Di")] = NumberObject(direction)
        page[NameObject("/Trans")] = trans
        wr.add_page(page)

    wr._root_object[NameObject("/PageMode")] = NameObject("/UseNone")
    prefs = DictionaryObject()
    prefs[NameObject("/HideToolbar")] = NameObject("/false")
    prefs[NameObject("/NonFullScreenPageMode")] = NameObject("/UseNone")
    wr._root_object[NameObject("/ViewerPreferences")] = prefs
    wr._root_object[NameObject("/OpenAction")] = ArrayObject(
        [wr.pages[0].indirect_reference, NameObject("/Fit")])

    tmp = PDF_PATH + ".tmp"
    with open(tmp, "wb") as fh:
        wr.write(fh)
    os.replace(tmp, PDF_PATH)
    print(f"[trans] page transitions stamped "
          f"({', '.join(sorted({t[0] for t in TRANSITIONS}))}) "
          f"- play in Acrobat full-screen (Ctrl+L)")


def verify(expected):
    import PyPDF2
    with open(PDF_PATH, "rb") as fh:
        rd = PyPDF2.PdfReader(fh)
        n = len(rd.pages)
        sizes = []
        for pg in rd.pages:
            bx = pg.mediabox
            sizes.append((round(float(bx.width) / 72 * 25.4, 1),
                          round(float(bx.height) / 72 * 25.4, 1)))
    ok = (n == expected) and all(abs(w - 210.0) < 0.5 and abs(h - 297.0) < 0.5
                                 for w, h in sizes)
    print(f"[chk ] pages={n} (expected {expected})   sizes={set(sizes)}   "
          f"{'OK - A4' if ok else '*** MISMATCH ***'}")
    return ok


def previews(scale=2.0):
    import pypdfium2 as pdfium
    os.makedirs(PREVIEW, exist_ok=True)
    for old in os.listdir(PREVIEW):
        if old.endswith(".png"):
            os.remove(os.path.join(PREVIEW, old))
    doc = pdfium.PdfDocument(PDF_PATH)
    for i in range(len(doc)):
        img = doc[i].render(scale=scale).to_pil()
        img.save(os.path.join(PREVIEW, f"page-{i + 1:02d}.png"))
    print(f"[png ] {len(doc)} previews at {scale}x -> {PREVIEW}")


if __name__ == "__main__":
    n = build_html()
    if "--html" not in sys.argv:
        render_pdf()
        add_transitions()
        verify(n)
        previews(2.0 if "--hi" not in sys.argv else 3.0)
