"""Pages 6-10 of the SplitX synopsis — the nine classic UML diagrams."""

from svgkit import (R, actor, arrow, badge, block, box, comp, container, cyl,
                    elbow, esc, f, line, node3d, note, oval, pkg, polyline, rect, state,
                    svg, text, tw, uml_class, wrap)


# ───────────────────────────────────────────────────────────────── helpers ──

def mult(x, y, s, *, col="#334155", fs=8.2, anchor="middle"):
    return text(x, y, s, fs=fs, weight=700, fill=col, anchor=anchor)


def alink(x1, y1, x2, y2, *, m1=None, m2=None, label=None, col="#6366f1",
          sw=1.35, dash=None, dia=None, arrowhead=None, m1off=(0, 0),
          m2off=(0, 0), loff=(0, 0), lbg=True, lfs=8.2):
    o = [line(x1, y1, x2, y2, stroke=col, sw=sw, dash=dash)]
    if dia:
        dx, dy = x2 - x1, y2 - y1
        n = max((dx ** 2 + dy ** 2) ** 0.5, 0.001)
        ux, uy = dx / n, dy / n
        px, py = -uy, ux
        L, Wd = 11.0, 5.0
        pts = [(x1, y1), (x1 + ux * L / 2 + px * Wd / 2, y1 + uy * L / 2 + py * Wd / 2),
               (x1 + ux * L, y1 + uy * L),
               (x1 + ux * L / 2 - px * Wd / 2, y1 + uy * L / 2 - py * Wd / 2)]
        p = " ".join(f"{f(a)},{f(b)}" for a, b in pts)
        o.append(f'<polygon points="{p}" fill="{"#6366f1" if dia == "filled" else "#fff"}" '
                 f'stroke="{col}" stroke-width="1.2"/>')
    if arrowhead:
        o.append(arrow(x1, y1, x2, y2, stroke=col, sw=0.01, head=arrowhead))
    if m1:
        o.append(mult(x1 + m1off[0], y1 + m1off[1], m1))
    if m2:
        o.append(mult(x2 + m2off[0], y2 + m2off[1], m2))
    if label:
        lx, ly = (x1 + x2) / 2 + loff[0], (y1 + y2) / 2 + loff[1]
        if lbg:
            wd = tw(label, lfs) + 8
            o.append(rect(R(lx - wd / 2, ly - lfs * 0.82, wd, lfs * 1.5),
                          fill="#fff", stroke="none", rx=3, opacity=0.94))
        o.append(text(lx, ly + lfs * 0.35, label, fs=lfs, weight=600, fill=col,
                      anchor="middle"))
    return "".join(o)


def lollipop(x, y, name, *, col="#0e7490", side="up", fs=7.8):
    dx, dy = (0, -11) if side == "up" else ((0, 11) if side == "down"
                                           else ((-11, 0) if side == "left" else (11, 0)))
    o = [line(x, y, x + dx, y + dy, stroke=col, sw=1.2),
         f'<circle cx="{f(x + dx)}" cy="{f(y + dy)}" r="3.4" fill="#fff" '
         f'stroke="{col}" stroke-width="1.3"/>']
    if side in ("up", "down"):
        o.append(text(x + 6, y + dy + (-4 if side == "up" else 8), name, fs=fs,
                      weight=700, fill=col))
    else:
        o.append(text(x + dx + (-6 if side == "left" else 6), y + dy - 6, name,
                      fs=fs, weight=700, fill=col,
                      anchor="end" if side == "left" else "start"))
    return "".join(o)


# ═════════════════════════════════════════════ PAGE 6a — USE CASE DIAGRAM ══

UC_COLS = [
    ("ACCOUNT & ACCESS", ["Register", "Sign In (credentials / OAuth)",
                          "Reset Password", "Manage Profile & UPI ID"]),
    ("GROUPS & MEMBERS", ["Create Group", "Invite Member", "Join via Code / QR",
                          "Remove Member", "Chat in Group"]),
    ("SETTLEMENT & INSIGHT", ["View Balances", "Compute Minimum Transfers",
                              "Pay & Confirm", "Approve Payment Received",
                              "View Analytics / Ask AI"]),
    ("EXPENSES & CAPTURE", ["Add Expense", "Choose Split Strategy",
                            "Scan Receipt", "Dictate by Voice"]),
]


def page6_usecase():
    VW, VH = 860, 520
    o = []
    bnd = R(132, 6, 560, 452)
    o.append(rect(bnd, fill="#fdfbff", stroke="#9333ea", sw=1.6, rx=10))
    o.append(text(bnd.cx, bnd.y + 15.5, "SplitX  —  System Boundary", fs=11.4,
                  weight=800, fill="#7e22ce", anchor="middle"))

    # ── geometry first, so association lines can be painted *behind* the ovals ──
    inner = R(bnd.x + 8, bnd.y + 24, bnd.w - 16, bnd.h - 32)
    cols = inner.cols(4, 9)
    ovals, heads = [], []
    for ci, (grp, ucs) in enumerate(UC_COLS):
        c = cols[ci]
        heads.append((c, grp))
        cell = R(c.x, c.y + 21, c.w, c.h - 21)
        slots = cell.rows(5, 8)
        ovals.append([slots[k] for k in range(len(ucs))])

    for c, grp in heads:
        o.append(rect(R(c.x, c.y, c.w, 15), fill="#f3e8ff", stroke="none", rx=5))
        o.append(text(c.cx, c.y + 11, grp, fs=7.6, weight=800, fill="#6b21a8",
                      anchor="middle", ls=0.45))

    # ── associations (drawn BEFORE the ovals: opaque ovals occlude them) ──
    ln = []
    A = "#c7b8f5"
    mem, own, oap = 118, 268, 408
    for tgt in (ovals[0][0], ovals[0][1], ovals[0][3]):
        ln.append(line(74, mem, tgt.x + 3, tgt.cy, stroke=A, sw=1.1))
    for ci in (1, 2, 3):
        t = ovals[ci][0]
        ln.append(polyline([(74, mem), (bnd.x - 6, mem), (bnd.x - 6, t.cy),
                            (t.x + 3, t.cy)], stroke=A, sw=1.1))
    for tgt in (ovals[1][0], ovals[1][3]):
        ln.append(line(74, own, tgt.x + 3, tgt.cy, stroke="#a855f7", sw=1.2))
    ln.append(line(74, oap, ovals[0][1].x + 3, ovals[0][1].cy, stroke="#67e8f9", sw=1.2))
    ln.append(line(74, oap, ovals[0][2].x + 3, ovals[0][2].cy, stroke="#67e8f9", sw=1.2))
    for tgt, ay in ((ovals[3][1], 92), (ovals[3][3], 92)):
        ln.append(line(tgt.x2 - 3, tgt.cy, 768, ay, stroke="#67e8f9", sw=1.2))
    ln.append(line(ovals[3][2].x2 - 3, ovals[3][2].cy, 768, 250, stroke="#67e8f9", sw=1.2))
    ln.append(polyline([(ovals[2][2].x2 - 3, ovals[2][2].cy), (bnd.x2 + 6, ovals[2][2].cy),
                        (bnd.x2 + 6, 400), (768, 400)], stroke="#67e8f9", sw=1.2))
    o.extend(ln)

    for ci, (grp, ucs) in enumerate(UC_COLS):
        for k, uc in enumerate(ucs):
            o.append(oval(ovals[ci][k], uc, fs=8.3, stroke="#a855f7", fill="#fff",
                          fillcol="#3b0764"))

    # ── «include» / «extend» ──
    o.append(alink(ovals[3][0].cx, ovals[3][0].y2, ovals[3][1].cx, ovals[3][1].y,
                   col="#7c3aed", dash="5 4", arrowhead="apo", label="«include»", lfs=7.6))
    o.append(alink(ovals[3][2].cx - 18, ovals[3][2].y, ovals[3][0].cx - 18,
                   ovals[3][1].y2, col="#7c3aed", dash="5 4", arrowhead="apo",
                   label="«extend»", lfs=7.6, loff=(-4, 0)))
    o.append(alink(ovals[3][3].x, ovals[3][3].cy, ovals[2][4].x2, ovals[2][4].cy,
                   col="#7c3aed", dash="5 4", arrowhead="apo", label="«extend»", lfs=7.6))
    o.append(alink(ovals[2][1].cx, ovals[2][1].y, ovals[2][0].cx, ovals[2][0].y2,
                   col="#7c3aed", dash="5 4", arrowhead="apo", label="«include»", lfs=7.6))
    o.append(alink(ovals[2][2].cx + 20, ovals[2][2].y, ovals[2][1].cx + 20,
                   ovals[2][1].y2, col="#7c3aed", dash="5 4", arrowhead="apo",
                   label="«include»", lfs=7.6, loff=(6, 0)))

    # ── actors, on top of everything ──
    o.append(actor(60, mem, "Group Member", sub="primary actor", col="#6b21a8"))
    o.append(actor(60, own, "Group Owner", sub="«admin» role", col="#6b21a8"))
    o.append(actor(60, oap, "OAuth Provider", sub="«system»", col="#0e7490"))
    o.append(actor(786, 92, "AI Services", sub="«system» Gemini · OpenAI", col="#0e7490"))
    o.append(actor(786, 250, "Object Storage", sub="«system» Supabase", col="#0e7490"))
    o.append(actor(786, 400, "UPI Payment App", sub="«system» PSP", col="#0e7490"))
    o.append(arrow(60, 240, 60, 152, stroke="#6b21a8", head="apt", sw=1.3))
    o.append(text(66, 198, "generalises", fs=7.8, weight=600, fill="#6b21a8"))

    # ── legend strip, outside the boundary ──
    lg = R(132, VH - 42, 560, 22)
    o.append(rect(lg, fill="#faf5ff", stroke="#e9d5ff", rx=6, sw=1))
    x = lg.x + 12
    for col, lab in [("#c7b8f5", "association"), ("#a855f7", "admin-only"),
                     ("#67e8f9", "system actor")]:
        o.append(line(x, lg.cy, x + 20, lg.cy, stroke=col, sw=1.6))
        o.append(text(x + 25, lg.cy + 3.1, lab, fs=8, weight=600, fill="#475569"))
        x += 32 + tw(lab, 8)
    o.append(text(lg.x2 - 12, lg.cy + 3.1,
                  "17 use cases  ·  3 human roles  ·  4 system actors",
                  fs=8, weight=700, fill="#6b21a8", anchor="end"))
    return svg(VW, VH, "".join(o))


# ═════════════════════════════════════════════ PAGE 6b — ACTIVITY DIAGRAM ══

def page6_activity():
    VW, VH = 860, 566
    o = []
    AB = dict(fill="#faf5ff", stroke="#a855f7", tfs=9.6, sfs=7.6, scol="#6b21a8", rx=9)

    def dia(cx, cy, w, h, label, fs=9.2):
        p = (f"M{f(cx)},{f(cy - h / 2)} L{f(cx + w / 2)},{f(cy)} "
             f"L{f(cx)},{f(cy + h / 2)} L{f(cx - w / 2)},{f(cy)} Z")
        out = [f'<path d="{p}" fill="#f3e8ff" stroke="#9333ea" stroke-width="1.4"/>']
        out.append(block(R(cx - w / 2 + 10, cy - h / 2, w - 20, h),
                         [{"text": label, "fs": fs, "weight": 700, "fill": "#6b21a8",
                           "max_lines": 2, "lh": fs * 1.1}], pad=2))
        return "".join(out)

    def bar(cx, y, w):
        return rect(R(cx - w / 2, y, w, 6), fill="#6b21a8", stroke="none", rx=2.5)

    o.append(f'<circle cx="430" cy="16" r="7.5" fill="#6b21a8"/>')
    r_open = R(300, 30, 260, 34)
    o.append(box(r_open, "Open “New Expense”", "amount · title · category · payer", **AB))
    o.append(arrow(430, 24, 430, 29, stroke="#7c3aed", head="ap", sw=1.6))

    o.append(dia(430, 88, 150, 42, "input mode ?"))
    o.append(arrow(430, r_open.y2, 430, 68, stroke="#7c3aed", head="ap", sw=1.6))

    lb = R(24, 122, 250, 38)
    mb = R(320, 122, 220, 38)
    rb = R(586, 122, 250, 38)
    o.append(box(lb, "Capture speech", "Web Speech API — live transcript", **AB))
    o.append(box(mb, "Enter values manually", "amount pad + member picker", **AB))
    o.append(box(rb, "Capture / upload receipt", "camera or file, stored in Supabase", **AB))
    o.append(elbow(355, 88, lb.cx, lb.y - 1, mid=lb.cx, stroke="#7c3aed",
                   head="ap", sw=1.5, label="[voice]", lfs=7.8))
    o.append(arrow(430, 109, 430, mb.y - 1, stroke="#7c3aed", head="ap", sw=1.5,
                   label="[manual]", lfs=7.8))
    o.append(elbow(505, 88, rb.cx, rb.y - 1, mid=rb.cx, stroke="#7c3aed",
                   head="ap", sw=1.5, label="[receipt]", lfs=7.8))

    lb2 = R(24, 174, 250, 38)
    rb2 = R(586, 174, 250, 38)
    rb3 = R(586, 226, 250, 38)
    o.append(box(lb2, "Parse transcript", "Gemini 2.0 Flash → structured expense (regex fallback)", **AB))
    o.append(box(rb2, "Extract line items", "Tesseract.js on-device  or  GPT-4o-mini Vision", **AB))
    o.append(box(rb3, "Assign items to members", "per-item selection, tax prorated", **AB))
    o.append(arrow(lb.cx, lb.y2, lb2.cx, lb2.y - 1, stroke="#7c3aed", head="ap", sw=1.5))
    o.append(arrow(rb.cx, rb.y2, rb2.cx, rb2.y - 1, stroke="#7c3aed", head="ap", sw=1.5))
    o.append(arrow(rb2.cx, rb2.y2, rb3.cx, rb3.y - 1, stroke="#7c3aed", head="ap", sw=1.5))

    o.append(dia(430, 286, 76, 34, ""))
    o.append(text(430, 289, "merge", fs=8, weight=700, fill="#6b21a8", anchor="middle"))
    o.append(elbow(lb2.cx, lb2.y2, 392, 286, vfirst=True, mid=274, stroke="#7c3aed",
                   head="ap", sw=1.5))
    o.append(arrow(mb.cx, mb.y2, 430, 269, stroke="#7c3aed", head="ap", sw=1.5))
    o.append(elbow(rb3.cx, rb3.y2, 468, 286, vfirst=True, mid=274, stroke="#7c3aed",
                   head="ap", sw=1.5))

    r_split = R(250, 320, 360, 36)
    o.append(box(r_split, "Select split strategy",
                 "equal  ·  percentage  ·  custom amounts  ·  by item", **AB))
    o.append(arrow(430, 303, 430, r_split.y - 1, stroke="#7c3aed", head="ap", sw=1.5))

    o.append(dia(430, 390, 190, 44, "Σ splits = amount ?"))
    o.append(arrow(430, r_split.y2, 430, 368, stroke="#7c3aed", head="ap", sw=1.5))
    err = R(650, 372, 186, 36)
    o.append(box(err, "Show validation error", "highlight the difference", fill="#fef2f2",
                 stroke="#f87171", tfs=9.4, sfs=7.5, scol="#991b1b", rx=9))
    o.append(arrow(525, 390, err.x - 1, 390, stroke="#dc2626", head="ar", sw=1.5,
                   label="[no]", lfs=7.8))
    o.append(elbow(err.cx, err.y - 1, r_split.x2 + 1, r_split.cy, vfirst=True,
                   mid=338, stroke="#dc2626", head="ar", sw=1.4))

    o.append(bar(430, 434, 560))
    o.append(arrow(430, 412, 430, 433, stroke="#7c3aed", head="ap", sw=1.5,
                   label="[yes]", lfs=7.8))
    par = R(150, 448, 560, 44).cols(3, 12)
    pl = [("Persist Transaction + SplitItem[]", "one Prisma transaction, amounts in paise"),
          ("Fan out notifications", "to every other group member"),
          ("Append audit-log entry", "immutable, actor + before/after")]
    for r_, (a, bb) in zip(par, pl):
        o.append(box(r_, a, bb, **AB))
        o.append(arrow(r_.cx, 440, r_.cx, r_.y - 1, stroke="#7c3aed", head="ap", sw=1.3))
    o.append(bar(430, 500, 560))
    for r_ in par:
        o.append(arrow(r_.cx, r_.y2 + 1, r_.cx, 499, stroke="#7c3aed", head="ap", sw=1.3))

    seq = R(24, 514, 700, 40).cols(3, 14)
    sl = [("Recompute member balances", "paid − owed per member"),
          ("Simplify debt graph", "greedy netting vs exact-match pruning → fewer transfers"),
          ("Render settlement plan", "minimum transfer set + UPI actions")]
    for r_, (a, bb) in zip(seq, sl):
        o.append(box(r_, a, bb, **AB))
    o.append(elbow(430, 506, seq[0].cx, seq[0].y - 1, vfirst=True, mid=510,
                   stroke="#7c3aed", head="ap", sw=1.5))
    for k in range(2):
        o.append(arrow(seq[k].x2 + 1, seq[k].cy, seq[k + 1].x - 2, seq[k + 1].cy,
                       stroke="#7c3aed", head="ap", sw=1.4))
    o.append(arrow(seq[2].x2 + 2, seq[2].cy, 806, seq[2].cy, stroke="#7c3aed",
                   head="ap", sw=1.5))
    o.append(f'<circle cx="822" cy="{f(seq[2].cy)}" r="9" fill="none" '
             f'stroke="#6b21a8" stroke-width="1.6"/>')
    o.append(f'<circle cx="822" cy="{f(seq[2].cy)}" r="5.2" fill="#6b21a8"/>')
    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════════════ PAGE 7 — CLASS DIAGRAM ══════

def page7_fig():
    VW, VH = 860, 1152
    o = []
    IC = "#6366f1"

    dom = R(20, 14, 820, 690)
    rws = dom.rows(weights=[172, 216, 212], gap=32)
    c0a, c1a, c2a = rws[0].cols(3, 24)
    c0b, c1b, c2b = rws[1].cols(3, 24)
    c0c, c1c, c2c = rws[2].cols(3, 24)

    o.append(uml_class(c0a, "User",
                       ["− id : Cuid  «PK»", "− name : String?", "− email : String? «unique»",
                        "− password : String?  «bcrypt»", "− phone : String?",
                        "− upiId : String?", "− image : String?",
                        "− createdAt / updatedAt : DateTime"],
                       ["+ balanceIn(group) : Money", "+ isMemberOf(group) : Boolean"],
                       nfs=11.4))
    o.append(uml_class(c1a, "GroupMember",
                       ["− id : Cuid  «PK»", "− groupId : Cuid  «FK»", "− userId : Cuid  «FK»",
                        "− role : MemberRole = member", "− nickname : String?",
                        "− joinedAt : DateTime",
                        "«unique» (groupId, userId)"],
                       ["+ isAdmin() : Boolean"], stereo="association class", nfs=11.0))
    o.append(uml_class(c2a, "Group",
                       ["− id : Cuid  «PK»", "− name : String", "− emoji : String?",
                        "− inviteCode : Cuid «unique»", "− ownerId : Cuid  «FK»",
                        "− deletedAt : DateTime?  «soft delete»",
                        "− createdAt / updatedAt : DateTime"],
                       ["+ regenerateInviteCode()", "+ softDelete()"], nfs=11.4))

    o.append(uml_class(c0b, "SplitItem",
                       ["− id : Cuid  «PK»", "− transactionId : Cuid «FK»",
                        "− userId : Cuid  «FK»", "− amount : Int  «paise»",
                        "«unique» (transactionId, userId)"],
                       ["+ toRupees() : Decimal"], nfs=11.0))
    o.append(uml_class(c1b, "Transaction",
                       ["− id : Cuid  «PK»", "− tripId : Cuid  «FK»", "− payerId : Cuid «FK»",
                        "− amount : Int  «paise»", "− title : String",
                        "− category : TxCategory = general", "− method : PayMethod = cash",
                        "− splitType : SplitType = equal", "− receiptUrl : String?",
                        "− date : DateTime", "− deletedAt : DateTime?"],
                       ["+ split(strategy) : SplitItem[]", "+ validateSplits() : Boolean"],
                       nfs=11.4))
    o.append(uml_class(c2b, "Trip",
                       ["− id : Cuid  «PK»", "− groupId : Cuid  «FK»", "− title : String",
                        "− description : String?", "− startDate : DateTime?",
                        "− endDate : DateTime?", "− currency : String = INR",
                        "− isActive : Boolean = true"],
                       ["+ totalSpend() : Money"], nfs=11.4))

    o.append(note(c0c, ["All monetary values are stored as integer paise "
                        "(₹1 = 100) so no floating-point rounding can ever "
                        "corrupt a balance.",
                        "Equal splits distribute the remainder paise to the "
                        "first N members, guaranteeing Σ splits = amount."],
                  title="«note»  money representation", fs=8.4, tfs=9.2))
    o.append(uml_class(c1c, "Settlement",
                       ["− id : Cuid  «PK»", "− tripId : Cuid  «FK»",
                        "− fromId : Cuid  «FK, debtor»", "− toId : Cuid  «FK, creditor»",
                        "− amount : Int  «paise»",
                        "− status : SettlementStatus = pending",
                        "− method : String?", "− utrNumber : String?",
                        "− deletedAt : DateTime?"],
                       ["+ initiate() : UpiLink", "+ confirmByPayer(utr)",
                        "+ approveByReceiver()", "+ cancel(reason)"], nfs=11.4))
    o.append(note(c2c, ["computeBalances → balance = paid − owed per member.",
                        "Both greedy netting and exact-match pruning are run; "
                        "the plan with fewer transfers wins.",
                        "Worst case O(n log n); typical result is n−1 transfers "
                        "instead of O(n²)."],
                  title="«note»  settlement algorithm", fs=8.4, tfs=9.2))

    # associations
    o.append(alink(c0a.x2, c0a.cy - 18, c1a.x, c1a.cy - 18, m1="1", m2="0..*",
                   m1off=(14, -5), m2off=(-16, -5), label="member of", col=IC))
    o.append(alink(c1a.x2, c1a.cy - 18, c2a.x, c2a.cy - 18, m1="0..*", m2="1",
                   m1off=(16, -5), m2off=(-12, -5), label="has member", col=IC))
    o.append(elbow(c0a.cx + 20, c0a.y, c2a.cx - 20, c2a.y, mid=6, vfirst=True,
                   stroke=IC, sw=1.35, head=None))
    o.append(text((c0a.cx + c2a.cx) / 2, 4, "1  «owns»  0..*", fs=8.2, weight=700,
                  fill=IC, anchor="middle"))
    o.append(alink(c2a.cx, c2a.y2, c2b.cx, c2b.y, m1="1", m2="1..*",
                   m1off=(-14, 12), m2off=(-16, -6), label="contains", col=IC))
    o.append(alink(c2b.x, c2b.cy, c1b.x2, c1b.cy, m1="1", m2="0..*",
                   m1off=(-14, -6), m2off=(16, -6), label="logs", col=IC))
    o.append(alink(c1b.x, c1b.cy + 26, c0b.x2, c0b.cy + 26, m1="1", m2="1..*",
                   m1off=(-14, -6), m2off=(16, -6), label="split into", col=IC,
                   dia="filled"))
    o.append(alink(c0a.cx, c0a.y2, c0b.cx, c0b.y, m1="1", m2="0..*",
                   m1off=(-14, 12), m2off=(-16, -6), label="owes", col=IC))
    o.append(alink(c0a.x2, c0a.y2 - 26, c1b.x, c1b.y + 22, m1="1", m2="0..*",
                   m1off=(12, 12), m2off=(-6, -8), label="«payer»", col="#0891b2"))
    o.append(alink(c2b.cx - 30, c2b.y2, c1c.x2, c1c.y + 26, m1="1", m2="0..*",
                   m1off=(-14, 12), m2off=(12, -6), label="settles", col=IC))
    o.append(elbow(c1c.x, c1c.y2 - 8, c0a.x, c0a.cy + 30, mid=10, stroke="#0891b2",
                   sw=1.35, head=None))
    _fl = "0..*  «from / to»  2"
    _fw = tw(_fl, 8.2) + 10
    o.append(rect(R(16, c0c.y - 20, _fw, 14), fill="#fff", stroke="none", rx=3))
    o.append(text(21, c0c.y - 10, _fl, fs=8.2, weight=700, fill="#0891b2"))
    o.append(line(c0c.x2, c0c.cy, c1c.x, c0c.cy, stroke="#f59e0b", sw=1.1, dash="4 3"))
    o.append(line(c2c.x, c2c.cy, c1c.x2, c2c.cy, stroke="#f59e0b", sw=1.1, dash="4 3"))

    # ── services + enumerations ──
    bot = R(20, 726, 820, 370)
    lef, rig = bot.cols(weights=[63, 37], gap=18)
    s, li = container(lef, "SERVICE / DOMAIN-LOGIC CLASSES  (src/lib)",
                      fill="#f8fafc", stroke="#c7d2fe", lcol="#3730a3", lfs=10.4,
                      tag="stateless modules", tagfill="#e0e7ff")
    o.append(s)
    g = li.grid(3, 2, gx=14, gy=12)
    svcs = [
        ("SettlementEngine", ["− PAISE : int = 100"],
         ["+ calculateBalances(txns) : Balance[]", "+ minimizeTransfers(b) : Transfer[]",
          "+ optimizeSettlements(b) : Transfer[]", "+ calculateEqualSplit(total, n)"]),
        ("GroupFinanceService", [],
         ["+ computeGroupBalances(g)", "+ simplifyGroupBalances(b)",
          "+ buildBalanceHistory(u, g)", "+ buildTimelineEvents(g)"]),
        ("TransactionParser", ["− CONFIDENCE_MIN : float"],
         ["+ parseTransactionText(raw)", "+ extractLineItems(text)",
          "− detectMethod(text)", "− extractUtr(text)"]),
        ("AuthService  «NextAuth v5»", ["− strategy : jwt (30 d)"],
         ["+ authorize(credentials)", "+ jwt(token) / session(s)",
          "+ linkOAuthAccount(profile)"]),
        ("NotificationService", [],
         ["+ notify(userId, type, payload)", "+ fanOutToGroup(g, event)",
          "+ cullStale(userId)"]),
        ("AuditService", [],
         ["+ createAuditLog(action, entity)", "+ snapshot(before, after)"]),
    ]
    for cell, (n, at, op) in zip(g, svcs):
        o.append(uml_class(cell, n, at, op, stereo="service", head="#e0f2fe",
                           stroke="#0e7490", ncol="#0e4f63", nfs=10.6, afs=8.3, hug=True))

    s, ri = container(rig, "ENUMERATED ATTRIBUTE DOMAINS", fill="#f8fafc",
                      stroke="#c7d2fe", lcol="#3730a3", lfs=10.4,
                      tag="stored as String", tagfill="#e0e7ff")
    o.append(s)
    er = ri.rows(weights=[95, 118, 68, 104], gap=10)
    o.append(uml_class(er[0], "SplitType",
                       ["equal", "percentage", "custom", "items"], None,
                       stereo="enumeration", head="#fef3c7", stroke="#d97706",
                       ncol="#78350f", nfs=10.8, afs=8.9, hug=True))
    o.append(uml_class(er[1], "SettlementStatus",
                       ["pending", "initiated", "paid_pending", "completed",
                        "confirmed  (legacy alias)", "cancelled"], None,
                       stereo="enumeration", head="#fee2e2", stroke="#dc2626",
                       ncol="#7f1d1d", nfs=10.8, afs=8.9, hug=True))
    o.append(uml_class(er[2], "MemberRole", ["admin", "member"], None,
                       stereo="enumeration", head="#dcfce7", stroke="#16a34a",
                       ncol="#14532d", nfs=10.8, afs=8.9, hug=True))
    o.append(uml_class(er[3], "PayMethod",
                       ["cash", "gpay", "phonepe", "paytm", "upi_other"], None,
                       stereo="enumeration", head="#e0e7ff", stroke="#4f46e5",
                       ncol="#312e81", nfs=10.8, afs=8.9, hug=True))

    lg = R(20, 1104, 820, 40)
    o.append(rect(lg, fill="#fafcfe", stroke="#e2e8f0", rx=8))
    x = lg.x + 12
    for kind, lbl in [("line", "association + multiplicity"),
                      ("dia", "composition (whole ◆ part)"),
                      ("dash", "«include» / «extend» / note anchor"),
                      ("pk", "«PK» primary key   «FK» foreign key   «unique» constraint")]:
        if kind == "line":
            o.append(line(x, lg.cy, x + 26, lg.cy, stroke=IC, sw=1.5))
        elif kind == "dia":
            o.append(line(x, lg.cy, x + 26, lg.cy, stroke=IC, sw=1.5))
            o.append(f'<polygon points="{f(x)},{f(lg.cy)} {f(x + 6)},{f(lg.cy - 3.4)} '
                     f'{f(x + 12)},{f(lg.cy)} {f(x + 6)},{f(lg.cy + 3.4)}" fill="{IC}"/>')
        elif kind == "dash":
            o.append(line(x, lg.cy, x + 26, lg.cy, stroke="#7c3aed", sw=1.4, dash="5 4"))
        else:
            x -= 26
        o.append(text(x + 31, lg.cy + 3.2, lbl, fs=8.6, weight=600, fill="#475569"))
        x += 31 + tw(lbl, 8.6) + 22
    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════════ PAGE 8a — ER / DATA MODEL ══════

def _tbl(r, name, cols, *, head="#ddd6fe", stroke="#8b5cf6", ncol="#5b21b6"):
    return uml_class(r, name, cols, None, head=head, stroke=stroke, ncol=ncol,
                     nfs=10.4, afs=8.7, pad=5, lh=10.7)


def page8_er():
    """
    Orthogonal, gutter-routed ER diagram.  Relationship lines are emitted before
    the tables, so an opaque table always occludes whatever passes behind it, and
    every cross-column link travels inside the vertical gutter between its two
    columns instead of straight over the intervening tables.
    """
    VW, VH = 860, 676
    o = []
    band = R(14, 46, 832, 562)
    COLS = band.cols(4, 42)
    A, B, C, D = COLS
    GUT = [(COLS[k].x2 + COLS[k + 1].x) / 2 for k in range(3)]

    o.append(text(14, 12, "18 tables  \u00b7  PostgreSQL (Neon)  \u00b7  cuid primary keys  "
                          "\u00b7  soft delete on Group / Transaction / Settlement",
                  fs=8.4, weight=700, fill="#6b21a8"))
    o.append(text(846, 12, "1 \u2014 \u221e  one-to-many      \u00abUQ\u00bb unique      "
                           "\u00abIX\u00bb index      ON DELETE CASCADE unless noted",
                  fs=7.6, weight=700, fill="#64748b", anchor="end"))

    ar = A.rows(weights=[166, 106, 90, 98, 90], gap=16)
    br = B.rows(weights=[140, 122, 114, 128], gap=16)
    cr = C.rows(weights=[130, 174, 98, 154], gap=16)
    dr = D.rows(weights=[122, 138, 106, 114, 90], gap=16)
    colof = {}
    for idx, rows in enumerate((ar, br, cr, dr)):
        for r_ in rows:
            colof[id(r_)] = idx

    V = "#8b5cf6"

    def erlab(x, y, label):
        w = tw(label, 7.6) + 9
        return (rect(R(x - w / 2, y - 7, w, 13.5), fill="#fff", stroke="none", rx=3)
                + text(x, y + 3.2, label, fs=7.6, weight=700, fill=V, anchor="middle"))

    def rel(a_, b_, m2="\u221e", label=None, slot=0.0):
        """`a_` is the 1 side, `b_` the many side. Routed orthogonally."""
        ca, cb = colof[id(a_)], colof[id(b_)]
        out = []
        if ca == cb:
            u, l = (a_, b_) if a_.cy < b_.cy else (b_, a_)
            x = u.cx + slot
            out.append(polyline([(x, u.y2), (x, l.y)], stroke=V, sw=1.3))
            out.append(mult(x + 8, u.y2 + 8, "1" if u is a_ else m2))
            out.append(mult(x + 8, l.y - 2, m2 if u is a_ else "1"))
            if label:
                out.append(erlab(x, (u.y2 + l.y) / 2, label))
            return "".join(out)

        gx = GUT[min(ca, cb)] + slot
        ax = a_.x2 if ca < cb else a_.x
        bx = b_.x if ca < cb else b_.x2
        out.append(polyline([(ax, a_.cy), (gx, a_.cy), (gx, b_.cy), (bx, b_.cy)],
                            stroke=V, sw=1.3))
        out.append(mult(ax + (9 if ca < cb else -9), a_.cy - 5, "1"))
        out.append(mult(bx + (-9 if ca < cb else 9), b_.cy - 5, m2))
        if label:
            out.append(erlab(gx, (a_.cy + b_.cy) / 2, label))
        return "".join(out)

    # ── relationships first; the tables drawn afterwards occlude them ──
    o.append(rel(ar[0], ar[1], slot=-34))
    o.append(rel(ar[1], ar[2], slot=-34))
    o.append(rel(ar[0], br[0], label="owns", slot=-9))
    o.append(rel(ar[0], br[1], label="joins", slot=0))
    o.append(rel(ar[0], br[3], label="owns", slot=9))
    o.append(rel(br[0], br[1], slot=-36))
    o.append(rel(br[0], br[2], slot=36))
    o.append(rel(br[0], cr[0], label="hosts", slot=-8))
    o.append(rel(cr[0], cr[1], slot=-40))
    o.append(rel(cr[1], cr[2], slot=40))
    o.append(rel(cr[0], cr[3], label="settles", slot=0))
    o.append(rel(cr[1], dr[1], label="refs", slot=-9))
    o.append(rel(cr[3], dr[1], label="refs", slot=9))

    # long-haul Group -> GroupMessage, through the channel under the band
    ch = band.y2 + 17
    o.append(polyline([(br[0].cx - 22, br[0].y2), (br[0].cx - 22, ch),
                       (dr[1].cx, ch), (dr[1].cx, dr[1].y2)], stroke=V, sw=1.3,
                      dash="6 4"))
    o.append(erlab((br[0].cx + dr[1].cx) / 2, ch,
                   "GroupMessage.groupId \u2192 Group  (1 \u2014 \u221e)"))

    # User is the hub of the schema: one annotated channel above the band
    top = band.y - 17
    o.append(polyline([(ar[0].cx + 24, ar[0].y), (ar[0].cx + 24, top),
                       (dr[4].cx, top), (dr[4].cx, dr[4].y2 + 42)],
                      stroke="#0891b2", sw=1.2, dash="5 4"))
    lab = ("userId \u00abFK\u00bb \u00d7 9  \u2192  Account \u00b7 Session \u00b7 GroupMember \u00b7 Transaction \u00b7 "
           "SplitItem \u00b7 Settlement \u00b7 Notification \u00b7 Budget \u00b7 AuditLog")
    w = tw(lab, 7.4) + 14
    o.append(rect(R(band.cx - w / 2, top - 8, w, 15), fill="#fff", stroke="none", rx=4))
    o.append(text(band.cx, top + 3.2, lab, fs=7.4, weight=700, fill="#0891b2",
                  anchor="middle"))

    # ── tables ──
    HD = dict(head="#c7d2fe", stroke="#4f46e5", ncol="#312e81")
    o.append(_tbl(ar[0], "User", ["id  \u00abPK\u00bb", "name", "email  \u00abUQ\u00bb", "password",
                                  "phone", "upiId", "image", "createdAt",
                                  "updatedAt"], **HD))
    o.append(_tbl(ar[1], "Account", ["id  \u00abPK\u00bb", "userId  \u00abFK\u00bb", "provider",
                                     "providerAccountId", "\u00abUQ\u00bb provider+acctId"]))
    o.append(_tbl(ar[2], "Session", ["id  \u00abPK\u00bb", "userId  \u00abFK\u00bb",
                                     "sessionToken \u00abUQ\u00bb", "expires"]))
    o.append(_tbl(ar[3], "PasswordResetToken", ["id  \u00abPK\u00bb", "email", "token  \u00abUQ\u00bb",
                                                "expires", "\u00abUQ\u00bb email+token"]))
    o.append(_tbl(ar[4], "VerificationToken", ["identifier", "token  \u00abUQ\u00bb",
                                               "expires", "\u00abUQ\u00bb ident+token"]))

    o.append(_tbl(br[0], "Group", ["id  \u00abPK\u00bb", "name", "emoji", "inviteCode \u00abUQ\u00bb",
                                   "ownerId  \u00abFK\u00bb", "deletedAt", "createdAt"], **HD))
    o.append(_tbl(br[1], "GroupMember", ["id  \u00abPK\u00bb", "groupId  \u00abFK\u00bb",
                                         "userId  \u00abFK\u00bb", "role", "nickname",
                                         "joinedAt", "\u00abUQ\u00bb group+user"]))
    o.append(_tbl(br[2], "GroupInvitation", ["id  \u00abPK\u00bb", "groupId  \u00abFK\u00bb",
                                             "inviterId \u00abFK\u00bb", "inviteeId \u00abFK\u00bb",
                                             "status", "\u00abUQ\u00bb group+invitee"]))
    o.append(_tbl(br[3], "Contact", ["id  \u00abPK\u00bb", "ownerId  \u00abFK\u00bb", "name", "email",
                                     "phone", "linkedUserId \u00abFK\u00bb",
                                     "\u00abUQ\u00bb owner+email"]))

    o.append(_tbl(cr[0], "Trip", ["id  \u00abPK\u00bb", "groupId  \u00abFK\u00bb", "title", "startDate",
                                  "endDate", "currency", "isActive"], **HD))
    o.append(_tbl(cr[1], "Transaction", ["id  \u00abPK\u00bb", "tripId  \u00abFK, IX\u00bb",
                                         "payerId  \u00abFK, IX\u00bb", "amount  \u00abpaise\u00bb",
                                         "title", "category", "method", "splitType",
                                         "receiptUrl", "date", "deletedAt"], **HD))
    o.append(_tbl(cr[2], "SplitItem", ["id  \u00abPK\u00bb", "transactionId \u00abFK\u00bb",
                                       "userId  \u00abFK\u00bb", "amount  \u00abpaise\u00bb",
                                       "\u00abUQ\u00bb txn+user"]))
    o.append(_tbl(cr[3], "Settlement", ["id  \u00abPK\u00bb", "tripId  \u00abFK, IX\u00bb",
                                        "fromId  \u00abFK, IX\u00bb", "toId  \u00abFK, IX\u00bb",
                                        "amount  \u00abpaise\u00bb", "status  \u00abIX\u00bb", "method",
                                        "utrNumber", "deletedAt"], **HD))

    o.append(_tbl(dr[0], "Notification", ["id  \u00abPK\u00bb", "userId  \u00abFK, IX\u00bb",
                                          "actorId  \u00abFK, SET NULL\u00bb", "type", "title",
                                          "body", "read", "link"]))
    o.append(_tbl(dr[1], "GroupMessage", ["id  \u00abPK\u00bb", "groupId  \u00abFK, IX\u00bb",
                                          "senderId  \u00abFK\u00bb", "content", "type",
                                          "settlementId \u00abFK\u00bb",
                                          "transactionId \u00abFK\u00bb", "createdAt"]))
    o.append(_tbl(dr[2], "Budget", ["id  \u00abPK\u00bb", "userId  \u00abFK\u00bb", "category",
                                    "amount  \u00abpaise\u00bb", "month",
                                    "\u00abUQ\u00bb user+cat+month"]))
    o.append(_tbl(dr[3], "AuditLog", ["id  \u00abPK\u00bb", "userId  \u00abFK\u00bb", "action",
                                      "entityType", "entityId", "details  \u00abJSON\u00bb",
                                      "createdAt"]))
    o.append(_tbl(dr[4], "ChatMessage", ["id  \u00abPK\u00bb", "userId  \u00abFK\u00bb", "role",
                                         "content", "createdAt"]))
    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════════ PAGE 8b — PACKAGE DIAGRAM ══════

def page8_pkg():
    VW, VH = 860, 424
    o = []
    rws = R(12, 6, 836, 412).rows(weights=[118, 118, 118], gap=29)

    r1 = rws[0].cols(6, 13)
    p1 = [("src/app", "route groups (app) \u00b7 (auth) \u00b7 api/ \u2014 38 route handlers"),
          ("src/components", "ui \u00b7 features \u00b7 landing \u00b7 charts \u00b7 providers"),
          ("src/lib", "settlement \u00b7 groupFinance \u00b7 parser \u00b7 auth \u00b7 metrics"),
          ("src/hooks", "useTheme \u00b7 useCurrentUser \u00b7 usePullToRefresh"),
          ("src/styles", "tokens \u00b7 light / dark \u00b7 18 accent palettes"),
          ("prisma", "schema.prisma \u2014 18 models + migrations")]
    for r_, (n, s_) in zip(r1, p1):
        o.append(pkg(r_, n, s_, stroke="#6366f1", tabfill="#e0e7ff"))

    r2 = rws[1].cols(4, 15)
    p2 = [("terraform", "modules: vpc \u00b7 eks \u00b7 ecr \u00b7 cdn \u00b7 cicd \u2014 S3 remote state"),
          ("k8s", "base + overlays (local / aws) \u2014 Kustomize"),
          ("helm/splitx", "chart templates + values dev / prod / aws"),
          ("ansible", "inventory + playbooks \u2014 host configuration")]
    for r_, (n, s_) in zip(r2, p2):
        o.append(pkg(r_, n, s_, stroke="#ea580c", tabfill="#ffedd5"))

    r3 = rws[2].cols(4, 15)
    p3 = [("jenkins", "Jenkinsfile (12 stages) \u00b7 Dockerfile.jenkins \u00b7 plugins"),
          (".github/workflows", "ci \u00b7 cd-aws \u00b7 terraform \u00b7 pr-checks"),
          ("monitoring", "prometheus \u00b7 alertmanager \u00b7 loki \u00b7 promtail \u00b7 grafana"),
          ("argocd", "Application manifest + Kind cluster definition")]
    for r_, (n, s_) in zip(r3, p3):
        o.append(pkg(r_, n, s_, stroke="#16a34a", tabfill="#dcfce7"))

    def chip(x, y, lbl, col):
        w = tw(lbl, 7.4) + 9
        return (rect(R(x - w / 2, y - 6.6, w, 13), fill="#fff", stroke="none", rx=3)
                + text(x, y + 3.1, lbl, fs=7.4, weight=700, fill=col, anchor="middle"))

    def across(a, b_, lbl, col="#94a3b8"):
        """Sibling dependency inside one row \u2014 arrow in the column gap."""
        x1, x2 = (a.x2, b_.x) if a.cx < b_.cx else (a.x, b_.x2)
        return (arrow(x1, a.cy, x2, b_.cy, stroke=col, sw=1.2, dash="5 4", head="aso")
                + chip((x1 + x2) / 2,
                       a.y - 9 if a.y > 20 else a.cy - 13, lbl, col))

    def between(a, b_, lbl, col):
        """Cross-row dependency: both endpoints sit on the gap edges, so the
        whole edge stays inside the gap and never crosses a package box."""
        if a.cy < b_.cy:
            y1, y2 = a.y2, b_.y
        else:
            y1, y2 = a.y, b_.y2
        return (arrow(a.cx, y1, b_.cx, y2, stroke=col, sw=1.25, dash="5 4",
                      head="aso")
                + chip((a.cx + b_.cx) / 2, (y1 + y2) / 2, lbl, col))

    o.append(across(r1[0], r1[1], "\u00abimport\u00bb"))
    o.append(across(r1[1], r1[2], "\u00abimport\u00bb"))
    o.append(across(r1[2], r1[3], "\u00abimport\u00bb"))
    o.append(across(r1[4], r1[5], "\u00abaccess\u00bb"))
    o.append(between(r1[2], r2[0], "", "#ffffff00"))          # spacing only
    o.pop()
    o.append(arrow(r1[2].cx + 26, r1[2].y2, r1[5].cx - 26, r1[5].y2 + 2,
                   stroke="#94a3b8", sw=1.2, dash="5 4", head="aso",
                   curve=(0, 22)))
    o.append(chip((r1[2].cx + r1[5].cx) / 2, r1[2].y2 + 13,
                  "\u00abimport\u00bb Prisma client", "#94a3b8"))

    o.append(across(r2[0], r2[1], "provisions cluster", col="#ea580c"))
    o.append(across(r2[2], r2[1], "renders", col="#ea580c"))
    o.append(between(r3[0], r2[2], "helm upgrade", "#16a34a"))
    o.append(between(r3[1], r2[0], "plan / apply", "#16a34a"))
    o.append(between(r3[3], r2[2], "syncs", "#16a34a"))
    o.append(between(r3[2], r2[1], "scrapes", "#16a34a"))
    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════════ PAGE 9a — SEQUENCE DIAGRAM ═════

LIFELINES = [
    (54, "Member", "actor", True),
    (158, ":PWA Client", "React 19 · SWR", False),
    (272, ":ProxyMiddleware", "auth · rate limit · metrics", False),
    (398, ":RouteHandler", "/api/transactions | /api/settlements", False),
    (524, ":SettlementEngine", "src/lib/settlement.ts", False),
    (636, ":PrismaClient", "ORM", False),
    (730, ":PostgreSQL", "Neon", False),
    (812, "Receiver", "actor", True),
]

MSGS = [
    (0, 1, "1: enter expense (amount, title, split)", 0),
    (1, 2, "2: POST /api/transactions", 0),
    (2, 2, "3: verify session cookie · Redis sliding-window limit (50/min)", 2),
    (2, 1, "4: alt [limit exceeded] → 429 Too Many Requests", 1),
    (2, 3, "5: forward request", 0),
    (3, 3, "6: Zod validate · verify group membership · compute equal split", 2),
    (3, 5, "7: create Transaction + SplitItem[]", 0),
    (5, 6, "8: BEGIN · INSERT ×2 · COMMIT", 0),
    (6, 5, "9: rows", 1),
    (5, 3, "10: Transaction entity", 1),
    (3, 3, "11: fan out notifications · append audit log", 2),
    (3, 1, "12: 201 Created", 1),
    (1, 3, "13: GET /api/settlements/by-group", 0),
    (3, 5, "14: load transactions · splits · completed settlements", 0),
    (5, 3, "15: finance snapshot", 1),
    (3, 4, "16: computeGroupBalances() + simplify()", 0),
    (4, 4, "17: greedy netting  vs  exact-match pruning → keep fewer transfers", 2),
    (4, 3, "18: minimum transfer set", 1),
    (3, 1, "19: 200 OK + transfer list", 1),
    (0, 1, "20: tap “Pay via UPI”", 0),
    (1, 3, "21: POST /settlements/{id}/pay → status = initiated, upi:// link", 0),
    (0, 1, "22: POST /confirm(utr) → status = paid_pending", 0),
    (7, 1, "23: POST /approve → status = completed", 0),
]


def page9_seq():
    VW, VH = 860, 682
    o = []
    top = 8
    hh = 40
    y0 = top + hh + 20
    step = 25.4

    for cx, nm, sub, is_actor in LIFELINES:
        if is_actor:
            o.append(actor(cx, top + 18, nm, col="#9f1239", s=0.85, fs=8.6))
        else:
            wd = 108 if cx not in (636, 730) else 92
            r_ = R(cx - wd / 2, top, wd, hh)
            o.append(box(r_, nm, sub, fill="#fff1f2", stroke="#f43f5e", tfs=9.4,
                         sfs=7.3, scol="#9f1239", rx=4))
        o.append(line(cx, top + hh + 2, cx, VH - 16, stroke="#fb7185", sw=1.1,
                      dash="5 5"))

    # activation bars
    for idx, ya, yb in [(3, y0 + step * 4 - 6, y0 + step * 11 + 6),
                        (3, y0 + step * 12 - 6, y0 + step * 18 + 6),
                        (4, y0 + step * 15 - 6, y0 + step * 17 + 6),
                        (5, y0 + step * 6 - 6, y0 + step * 9 + 6),
                        (2, y0 + step * 1 - 6, y0 + step * 4 + 6)]:
        cx = LIFELINES[idx][0]
        o.append(rect(R(cx - 4.5, ya, 9, yb - ya), fill="#ffe4e6", stroke="#f43f5e",
                      sw=1.0, rx=1.5))

    # alt fragment around messages 3-4
    fr = R(LIFELINES[1][0] - 26, y0 + step * 2 - 14, LIFELINES[2][0] - LIFELINES[1][0] + 60,
           step * 2 + 8)
    o.append(rect(fr, fill="none", stroke="#9f1239", sw=1.1, dash="4 3", rx=2))
    o.append(rect(R(fr.x, fr.y, 34, 13), fill="#ffe4e6", stroke="#9f1239", sw=1.0, rx=2))
    o.append(text(fr.x + 17, fr.y + 9.6, "alt", fs=8, weight=800, fill="#9f1239",
                  anchor="middle"))

    for k, (a, b_, lbl, kind) in enumerate(MSGS):
        y = y0 + step * k
        xa, xb = LIFELINES[a][0], LIFELINES[b_][0]
        if kind == 2:  # self message
            o.append(f'<path d="M{f(xa + 5)},{f(y - 5)} H{f(xa + 46)} V{f(y + 7)} '
                     f'H{f(xa + 6)}" fill="none" stroke="#be123c" stroke-width="1.3" '
                     f'marker-end="url(#ar)"/>')
            o.append(text(xa + 52, y + 2.6, lbl, fs=8.1, weight=600, fill="#7f1d3a"))
        else:
            dash = "5 4" if kind == 1 else None
            col = "#94a3b8" if kind == 1 else "#be123c"
            o.append(arrow(xa + (5 if xb > xa else -5), y, xb + (-5 if xb > xa else 5),
                           y, stroke=col, sw=1.35, dash=dash,
                           head="aso" if kind == 1 else "ar"))
            mx = (xa + xb) / 2
            wd = tw(lbl, 8.1) + 8
            mx = max(min(mx, VW - wd / 2 - 4), wd / 2 + 4)
            o.append(rect(R(mx - wd / 2, y - 12.5, wd, 12), fill="#fff", stroke="none",
                          rx=3, opacity=0.95))
            o.append(text(mx, y - 3.6, lbl, fs=8.1, weight=600,
                          fill="#64748b" if kind == 1 else "#7f1d3a", anchor="middle"))

    lg = R(12, VH - 14, 836, 12)
    o.append(line(lg.x, lg.cy, lg.x + 22, lg.cy, stroke="#be123c", sw=1.4))
    o.append(text(lg.x + 27, lg.cy + 3, "synchronous call", fs=8, weight=600, fill="#64748b"))
    o.append(line(lg.x + 150, lg.cy, lg.x + 172, lg.cy, stroke="#94a3b8", sw=1.4, dash="5 4"))
    o.append(text(lg.x + 177, lg.cy + 3, "return message", fs=8, weight=600, fill="#64748b"))
    o.append(text(lg.x + 300, lg.cy + 3, "alt = combined fragment    ▮ = activation bar",
                  fs=8, weight=600, fill="#64748b"))
    return svg(VW, VH, "".join(o))


# ═════════════════════════════════════ PAGE 9b — STATE MACHINE DIAGRAM ═════

def page9_state():
    VW, VH = 860, 452
    o = []
    RC = "#e11d48"
    pend = R(96, 46, 168, 58)
    init = R(346, 46, 168, 58)
    paid = R(596, 46, 200, 58)
    comp = R(596, 186, 200, 58)
    conf = R(596, 292, 200, 52)
    canc = R(96, 358, 200, 56)

    o.append(f'<circle cx="52" cy="{f(pend.cy)}" r="8" fill="#9f1239"/>')
    o.append(arrow(62, pend.cy, pend.x - 3, pend.cy, stroke=RC, sw=1.6, head="ar"))
    o.append(text(52, pend.cy - 15, "settlement created", fs=7.8, weight=700,
                  fill="#9f1239", anchor="middle"))

    o.append(state(pend, "pending", "computed transfer recorded", stroke=RC))
    o.append(state(init, "initiated", "UPI deep link generated", stroke=RC))
    o.append(state(paid, "paid_pending", "awaiting receiver approval", stroke="#d97706",
                   tcol="#78350f", fill="#fffbeb"))
    o.append(state(comp, "completed", "balance reduced · notification sent",
                   stroke="#16a34a", tcol="#14532d", fill="#f0fdf4", final=True))
    o.append(state(conf, "confirmed", "legacy alias — also treated as settled",
                   stroke="#16a34a", tcol="#14532d", fill="#f0fdf4", final=True))
    o.append(state(canc, "cancelled", "rejected, or group soft-deleted",
                   stroke="#64748b", tcol="#334155", fill="#f8fafc", final=True))

    o.append(arrow(pend.x2 + 2, pend.cy, init.x - 3, init.cy, stroke=RC, sw=1.6,
                   head="ar", label="payer / pay()", lfs=8.2, lside=-11))
    o.append(text((pend.x2 + init.x) / 2, pend.cy + 15, "[generates upi:// link]",
                  fs=7.6, weight=600, fill="#9f1239", anchor="middle"))
    o.append(arrow(init.x2 + 2, init.cy, paid.x - 3, paid.cy, stroke=RC, sw=1.6,
                   head="ar", label="payer / confirm(utr)", lfs=8.2, lside=-11))
    o.append(arrow(pend.cx + 30, pend.y - 2, paid.cx - 30, paid.y - 2, stroke="#d97706",
                   sw=1.5, head="am", curve=(0, -46),
                   label="payer or receiver / confirm()", lfs=8.2, lside=-24))
    o.append(arrow(paid.cx, paid.y2 + 2, comp.cx, comp.y - 3, stroke="#16a34a",
                   sw=1.7, head="ag", label="receiver / approve()", lfs=8.4))
    o.append(elbow(paid.x, paid.cy + 16, init.cx, init.y2 + 2, mid=paid.x - 34,
                   stroke="#d97706", sw=1.5, head="am", dash="5 4"))
    o.append(text(paid.x - 96, paid.cy + 44, "receiver / reject()  [re-open]", fs=8,
                  weight=700, fill="#b45309"))
    o.append(elbow(init.cx - 40, init.y2 + 2, comp.x - 3, comp.cy, mid=comp.cy,
                   vfirst=True, stroke="#16a34a", sw=1.5, head="ag", dash="4 3"))
    o.append(text(init.cx + 20, comp.cy - 7, "receiver / acceptCash()", fs=8,
                  weight=700, fill="#15803d"))
    o.append(arrow(pend.cx, pend.y2 + 2, canc.cx, canc.y - 3, stroke="#64748b",
                   sw=1.5, head="a", label="receiver / reject()", lfs=8.2))
    o.append(text(pend.cx, canc.y - 22, "system / groupDeleted()", fs=7.8, weight=600,
                  fill="#475569", anchor="middle"))

    o.append(note(R(330, 196, 232, 96),
                  ["SETTLEMENT_PENDING = { pending, initiated,", "        paid_pending }",
                   "SETTLEMENT_COMPLETED = { completed, confirmed }",
                   "cancelled is terminal and excluded from balances."],
                  title="«note»  status groupings", fs=7.9, tfs=8.8))
    o.append(note(R(330, 306, 232, 108),
                  ["Only the debtor may pay() and confirm().",
                   "Only the creditor may approve(), reject() or acceptCash().",
                   "Every transition writes an AuditLog row and notifies the "
                   "counterparty."],
                  title="«note»  transition guards", fs=7.9, tfs=8.8,
                  fill="#eff6ff", stroke="#3b82f6", tcol="#1e3a8a"))
    o.append(line(562, 244, 596, 216, stroke="#f59e0b", sw=1.1, dash="4 3"))
    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════ PAGE 10a — COMPONENT DIAGRAM ═══════

def page10_comp():
    VW, VH = 860, 400
    o = []
    CB = dict(fill="#ecfeff", stroke="#0e7490", tfs=10.2, sfs=7.9, scol="#155e75")
    EB = dict(fill="#f8fafc", stroke="#64748b", tfs=10.0, sfs=7.8, scol="#475569")
    C = "#0e7490"

    def ilab(x, y, lbl, col=C, fs=7.6):
        """Interface label on an opaque chip so it never sits on a component."""
        w = tw(lbl, fs) + 9
        return (rect(R(x - w / 2, y - 6.8, w, 13.2), fill="#fff", stroke="none", rx=3)
                + text(x, y + 3.2, lbl, fs=fs, weight=700, fill=col, anchor="middle"))

    ui = R(282, 10, 300, 56)
    o.append(comp(ui, "Web UI  (Installable PWA)",
                  "React 19 \u00b7 SWR \u00b7 service worker \u00b7 18 themes", **CB))

    r2 = R(38, 108, 798, 66).cols(3, 26)
    o.append(comp(r2[0], "API Gateway Middleware",
                  "session guard \u00b7 rate limit \u00b7 metrics \u00b7 requestId", **CB))
    o.append(comp(r2[1], "Auth Module  (NextAuth v5)",
                  "credentials + Google/GitHub OAuth \u00b7 JWT 30 d", **CB))
    o.append(comp(r2[2], "AI Gateway",
                  "receipt vision \u00b7 voice parse \u00b7 financial assistant", **CB))

    r3 = R(38, 216, 798, 66).cols(3, 26)
    o.append(comp(r3[0], "Expense Service",
                  "38 route handlers \u00b7 Zod validation \u00b7 authorisation", **CB))
    o.append(comp(r3[1], "Settlement Engine",
                  "balances \u00b7 debt simplification \u00b7 min transfer set", **CB))
    o.append(comp(r3[2], "Observability Agent",
                  "prom-client registry \u00b7 structured JSON logs", **CB))

    r4 = R(38, 324, 798, 66).cols(3, 26)
    o.append(comp(r4[0], "Persistence  (Prisma ORM)",
                  "type-safe queries \u00b7 migrations \u00b7 connection pooling", **CB))
    o.append(comp(r4[1], "External data services",
                  "Neon PostgreSQL \u00b7 Upstash Redis \u00b7 Supabase Storage \u00b7 Resend",
                  stereo="external", **EB))
    o.append(comp(r4[2], "External AI providers",
                  "Google Gemini 2.0 Flash \u00b7 OpenAI GPT-4o-mini Vision",
                  stereo="external", **EB))

    # ── vertical required-interface dependencies: label inside the row gap ──
    for sx, tgt, lbl in [(ui.cx - 96, r2[0], "\u00abuse\u00bb IHttpEntry"),
                         (ui.cx, r2[1], "IAuthSession"),
                         (ui.cx + 96, r2[2], "IReceiptParse")]:
        o.append(arrow(sx, ui.y2 + 2, tgt.cx, tgt.y - 4, stroke=C, sw=1.4,
                       head="aco", dash="5 4"))
        o.append(ilab((sx + tgt.cx) / 2, (ui.y2 + tgt.y) / 2, lbl))
    for a, b_, lbl in [(r2[0], r3[0], "IExpenseAPI"), (r3[0], r4[0], "IPersistence")]:
        o.append(arrow(a.cx, a.y2 + 2, b_.cx, b_.y - 4, stroke=C, sw=1.4,
                       head="aco", dash="5 4"))
        o.append(ilab(a.cx, (a.y2 + b_.y) / 2, lbl))
    # routed down the right margin: the Observability Agent sits between these two
    o.append(polyline([(r2[2].x2 + 2, r2[2].cy + 16), (850, r2[2].cy + 16),
                       (850, r4[2].cy), (r4[2].x2 + 4, r4[2].cy)],
                      stroke="#475569", sw=1.4, dash="5 4", head="aso"))
    o.append(ilab(850, (r2[2].cy + r4[2].cy) / 2, "HTTPS", col="#475569"))

    # ── horizontal dependencies: label lifted into the gap above the row ──
    for a, b_, lbl, col in [(r3[0], r3[1], "ISettlement", C),
                            (r3[1], r3[2], "IMetrics", C),
                            (r4[0], r4[1], "SQL / REST", "#475569")]:
        o.append(arrow(a.x2 + 2, a.cy, b_.x - 4, b_.cy, stroke=col, sw=1.4,
                       head="aco" if col == C else "aso", dash="5 4"))
        o.append(ilab((a.x2 + b_.x) / 2, a.y - 11, lbl, col=col))

    # ── Auth Module -> Persistence, routed down the left margin ──
    o.append(polyline([(r2[1].x + 30, r2[1].y2 + 2), (r2[1].x + 30, r2[1].y2 + 15),
                       (16, r2[1].y2 + 15), (16, r4[0].y2 - 14),
                       (r4[0].x + 30, r4[0].y2 - 14), (r4[0].x + 30, r4[0].y2 + 2)],
                      stroke=C, sw=1.4, dash="5 4", head="aco"))
    o.append(f'<text x="10" y="{f((r2[1].cy + r4[0].cy) / 2)}" '
             f'transform="rotate(-90 10 {f((r2[1].cy + r4[0].cy) / 2)})" '
             f'font-size="7.6" font-weight="700" fill="{C}" '
             f'text-anchor="middle">IUserStore</text>')

    # ── provided interfaces (lollipops), lifted clear of the component titles ──
    for r_, nm in [(r2[0], "IHttpEntry"), (r3[1], "ISettlement"),
                   (r4[0], "IPersistence"), (r3[2], "IMetrics \u00b7 ILogs")]:
        o.append(lollipop(r_.x + 26, r_.y, nm, col=C, side="up"))
    return svg(VW, VH, "".join(o))


# ═════════════════════════════════════════ PAGE 10b — OBJECT DIAGRAM ═══════

def _obj(r, name, cls, slots, *, head="#e0e7ff", stroke="#4f46e5", ncol="#312e81"):
    out = [rect(r, fill="#fff", stroke=stroke, sw=1.25, rx=4),
           rect(R(r.x + 0.7, r.y + 0.7, r.w - 1.4, 15.5), fill=head, stroke="none", rx=3.2),
           f'<path d="M{f(r.x)},{f(r.y + 16.2)} H{f(r.x2)}" stroke="{stroke}" stroke-width="1"/>']
    lbl = f"{name} : {cls}"
    out.append(text(r.cx, r.y + 11.6, lbl, fs=8.9, weight=800, fill=ncol,
                    anchor="middle"))
    out.append(f'<line x1="{f(r.cx - tw(lbl, 8.9) / 2)}" y1="{f(r.y + 13.4)}" '
               f'x2="{f(r.cx + tw(lbl, 8.9) / 2)}" y2="{f(r.y + 13.4)}" '
               f'stroke="{ncol}" stroke-width="0.9"/>')
    y = r.y + 21
    for s_ in slots:
        for ln in wrap(s_, 7.4, r.w - 9, 1):
            out.append(text(r.x + 5, y + 6.2, ln, fs=7.4, weight=400, fill="#3f4c60"))
            y += 9.2
    return "".join(out)


def page10_obj():
    VW, VH = 424, 344
    o = []
    V = "#4f46e5"
    g = R(6, 8, 168, 46)
    t = R(6, 68, 168, 46)
    tx = R(6, 128, 168, 62)
    st = R(6, 204, 168, 62)
    o.append(_obj(g, "goa", "Group", ['name = "Goa Trip 2026"', 'inviteCode = "c8f2…"']))
    o.append(_obj(t, "t1", "Trip", ['title = "Goa 2026"', 'currency = "INR"']))
    o.append(_obj(tx, "tx1", "Transaction", ['title = "Beach Hotel"',
                                             "amount = 1 200 000 p  (₹12 000)",
                                             'splitType = "equal"', "payer = sayan"]))
    o.append(_obj(st, "st1", "Settlement", ["from = sneha,  to = sayan",
                                            "amount = 400 000 p  (₹4 000)",
                                            'status = "paid_pending"'],
                  head="#fee2e2", stroke="#dc2626", ncol="#7f1d1d"))

    sp = R(186, 128, 106, 138).rows(3, 8)
    for k, (nm, who) in enumerate([("s1", "sayan"), ("s2", "sneha"), ("s3", "ankan")]):
        o.append(_obj(sp[k], nm, "SplitItem", [f"user = {who}", "amount = 400 000 p"],
                      head="#dcfce7", stroke="#16a34a", ncol="#14532d"))

    us = R(304, 8, 114, 138).rows(3, 8)
    for k, (nm, real) in enumerate([("sayan", '"Sayandip"'), ("sneha", '"Sneha"'),
                                    ("ankan", '"Ankan"')]):
        o.append(_obj(us[k], nm, "User", [f"name = {real}",
                                          "upiId = " + ("\"say@upi\"" if k == 0 else "…")],
                      head="#c7d2fe"))

    o.append(note(R(304, 158, 114, 108),
                  ["sayan  +800 000 p", "sneha  −400 000 p", "ankan  −400 000 p",
                   "→ 2 transfers of ₹4 000 settle the group."],
                  title="balances", fs=7.3, tfs=8.2))

    o.append(line(g.cx, g.y2, t.cx, t.y, stroke=V, sw=1.2))
    o.append(text(g.cx + 6, (g.y2 + t.y) / 2 + 3, "1  hosts  1..*", fs=7, weight=700, fill=V))
    o.append(line(t.cx, t.y2, tx.cx, tx.y, stroke=V, sw=1.2))
    o.append(text(t.cx + 6, (t.y2 + tx.y) / 2 + 3, "1  logs  0..*", fs=7, weight=700, fill=V))
    o.append(line(tx.cx, tx.y2, st.cx, st.y, stroke="#dc2626", sw=1.2, dash="4 3"))
    o.append(text(tx.cx + 6, (tx.y2 + st.y) / 2 + 3, "derived", fs=7, weight=700, fill="#dc2626"))
    for k in range(3):
        o.append(line(tx.x2, tx.cy - 12 + k * 12, sp[k].x, sp[k].cy, stroke="#16a34a", sw=1.1))
        o.append(line(sp[k].x2, sp[k].cy, us[k].cx, us[k].y2 if k < 2 else us[2].y2,
                      stroke="#94a3b8", sw=1.0, dash="3 3"))
    o.append(line(g.x2, g.cy, us[0].x, us[0].cy, stroke=V, sw=1.2))
    o.append(text((g.x2 + us[0].x) / 2, g.cy - 5, "owner", fs=7, weight=700, fill=V,
                  anchor="middle"))
    return svg(VW, VH, "".join(o))


# ════════════════════════════════════ PAGE 10c — COMMUNICATION DIAGRAM ═════

def page10_comm():
    VW, VH = 430, 344
    o = []
    C = "#0891b2"

    pw = R(4, 6, 122, 44)
    pm = R(154, 6, 122, 44)
    rl = R(304, 6, 122, 44)
    th = R(154, 122, 122, 50)
    se = R(304, 122, 122, 50)
    ns = R(4, 244, 122, 46)
    pr = R(154, 244, 122, 46)

    def ob(r_, nm, sub):
        out = [rect(r_, fill="#ecfeff", stroke="#0891b2", sw=1.25, rx=4)]
        out.append(text(r_.cx, r_.y + 13.4, nm, fs=8.8, weight=800, fill="#155e75",
                        anchor="middle"))
        out.append(f'<line x1="{f(r_.cx - tw(nm, 8.8) / 2)}" y1="{f(r_.y + 15.4)}" '
                   f'x2="{f(r_.cx + tw(nm, 8.8) / 2)}" y2="{f(r_.y + 15.4)}" '
                   f'stroke="#155e75" stroke-width="0.9"/>')
        out.append(block(R(r_.x, r_.y + 17, r_.w, r_.h - 17),
                         [{"text": sub, "fs": 7.1, "weight": 400, "fill": "#155e75",
                           "max_lines": 3}], pad=5))
        return "".join(out)

    def chip(x, y, lbl, col=C, fs=7.3):
        w = tw(lbl, fs) + 8
        return (rect(R(x - w / 2, y - 6.4, w, 12.6), fill="#fff", stroke="none", rx=3)
                + text(x, y + 3.1, lbl, fs=fs, weight=700, fill=col, anchor="middle"))

    def msg(x1, y1, x2, y2, lbl, *, bow=0, col=C, dash=None, lo=(0, 0), at=0.74):
        """Quadratic link with an optional bow.

        The label sits at the curve midpoint and the direction marker at `at`
        along the curve, so the opaque label chip never hides the arrowhead.
        """
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = x2 - x1, y2 - y1
        n = max((dx * dx + dy * dy) ** 0.5, 0.001)
        cx_, cy_ = mx - dy / n * bow, my + dx / n * bow           # control point
        out = [f'<path d="M{f(x1)},{f(y1)} Q{f(cx_)},{f(cy_)} {f(x2)},{f(y2)}" '
               f'fill="none" stroke="#94a3b8" stroke-width="1.3"'
               + (f' stroke-dasharray="{dash}"' if dash else "") + "/>"]

        def bez(t):
            u = 1 - t
            return (u * u * x1 + 2 * u * t * cx_ + t * t * x2,
                    u * u * y1 + 2 * u * t * cy_ + t * t * y2)

        def tan(t):
            u = 1 - t
            return (2 * u * (cx_ - x1) + 2 * t * (x2 - cx_),
                    2 * u * (cy_ - y1) + 2 * t * (y2 - cy_))

        hx, hy = bez(at)
        tx_, ty_ = tan(at)
        tn = max((tx_ * tx_ + ty_ * ty_) ** 0.5, 0.001)
        out.append(arrow(hx - tx_ / tn * 7, hy - ty_ / tn * 7,
                         hx + tx_ / tn * 9, hy + ty_ / tn * 9, stroke=col, sw=1.6,
                         head="ac"))
        lx, ly = bez(0.5)
        out.append(chip(lx + lo[0], ly + lo[1], lbl, col=col))
        return "".join(out)

    o.append(ob(pw, ":PWAClient", "React 19 UI"))
    o.append(ob(pm, ":ProxyMiddleware", "auth \u00b7 limit \u00b7 metrics"))
    o.append(ob(rl, ":RateLimiter", "Upstash Redis window"))
    o.append(ob(th, ":TransactionHandler", "/api/transactions"))
    o.append(ob(se, ":SettlementEngine", "greedy + pruning"))
    o.append(ob(ns, ":NotificationService", "fan-out + audit"))
    o.append(ob(pr, ":PrismaClient", "\u2192 Neon PostgreSQL"))

    # bowed downwards so each label lands in the empty band under the top row
    o.append(msg(pw.x2, pw.cy, pm.x, pm.cy, "1: POST /api/transactions", bow=88))
    o.append(msg(pm.x2, pm.cy, rl.x, rl.cy, "2: limit(ip)", bow=88))
    o.append(msg(pm.cx, pm.y2, th.cx, th.y, "3: forward(req)", lo=(0, 10)))
    o.append(f'<path d="M{f(th.x2 - 22)},{f(th.y)} C{f(th.x2 + 12)},{f(th.y - 28)} '
             f'{f(th.x2 + 12)},{f(th.y + 20)} {f(th.x2 - 3)},{f(th.y + 15)}" '
             f'fill="none" stroke="#0891b2" stroke-width="1.4" marker-end="url(#ac)"/>')
    o.append(chip(th.x2 + 76, th.y - 26, "4: validate + authorise"))
    o.append(msg(th.cx, th.y2, pr.cx, pr.y, "5: create(tx, splits[])", lo=(0, -6)))
    o.append(msg(th.x + 14, th.y2, ns.x2 - 10, ns.y, "6: notify(members)", lo=(2, 4)))
    o.append(msg(th.x2, th.cy, se.x, se.cy, "7: simplify(balances)", bow=64))
    o.append(msg(th.x, th.cy + 14, pw.cx, pw.y2, "8: 201 Created", dash="5 4",
                 col="#64748b", lo=(-6, 8)))
    o.append(text(4, VH - 8, "sequence numbers on the links express ordering; the same "
                             "interaction is shown time-ordered on page 9",
                  fs=7.1, weight=600, fill="#94a3b8"))
    return svg(VW, VH, "".join(o))


# ═══════════════════════════════════════════ PAGE 10d — CONCLUSION ═════════

CONCLUSION = """
<div class="concl">
  <div class="cc" style="--ac:#0891b2">
    <h4>Results Achieved</h4>
    <ul>
      <li>Settlement reduced from <b>O(n&sup2;)</b> naive transfers to a <b>minimum transfer set</b> (typically n&minus;1).</li>
      <li><b>3-stage image, 430&nbsp;MB</b> and non-root, versus ~1.3&nbsp;GB for an equivalent single-stage build.</li>
      <li><b>2 &rarr; 10 pods in ~90&nbsp;s</b> under a k6 ramp; scale-in after the 120&nbsp;s stabilisation window.</li>
      <li><b>0.00% failed requests</b> across a rolling update, verified by k6 during <code>helm upgrade</code>.</li>
      <li><b>12-stage pipeline with 4 hard gates</b> (tests, SonarQube, Trivy CRITICAL, k6 smoke) that genuinely fail the build.</li>
      <li>CloudFront serves static assets from cache (<b>x-cache: Hit</b>) while <code>/api/*</code> correctly bypasses it.</li>
      <li><b>9 alert rules</b> routed through Alertmanager to a webhook within ~60&nbsp;s of a fault.</li>
    </ul>
  </div>
  <div class="cc" style="--ac:#4f46e5">
    <h4>Conclusion</h4>
    <p>SplitX demonstrates that an application and its delivery platform are one system.
    The same expense-splitting product becomes materially more reliable once it is
    reproducibly built, declaratively provisioned, automatically scaled and continuously
    observed.</p>
    <p>Every tool in the chain earns its place by answering a concrete question:
    <b>Docker</b> &mdash; will it run identically everywhere? <b>Terraform</b> &mdash; can the
    infrastructure be rebuilt from nothing? <b>Kubernetes</b> &mdash; what happens when a pod
    dies or traffic triples? <b>Jenkins and GitHub Actions</b> &mdash; can a bad commit reach
    production? <b>Prometheus, Loki and Grafana</b> &mdash; would we even notice?</p>
    <p>The autoscaling, caching and rollout behaviour reported here is measured from a
    running cluster, not asserted from configuration.</p>
  </div>
  <div class="cc" style="--ac:#7c3aed">
    <h4>Future Scope</h4>
    <ul>
      <li><b>KEDA / prometheus-adapter</b> for event-driven scaling on requests-per-second rather than CPU.</li>
      <li><b>Argo Rollouts</b> for canary and blue-green releases with automated metric analysis.</li>
      <li><b>OpenTelemetry</b> distributed tracing to join a Loki log line to its exact span.</li>
      <li><b>Karpenter + Spot</b> node provisioning and CloudFront multi-region failover.</li>
      <li><b>External Secrets Operator</b> backed by AWS Secrets Manager, replacing in-cluster Secrets.</li>
      <li><b>Service mesh mTLS</b> and policy enforcement (OPA Gatekeeper) between workloads.</li>
      <li>Multi-currency settlement with FX snapshots, and a native mobile shell.</li>
    </ul>
  </div>
</div>"""
