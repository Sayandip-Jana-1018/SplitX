"""Pages 1-5 of the SplitX synopsis."""

from svgkit import (R, arrow, badge, block, box, chiprow, comp, container, cyl,
                    elbow, esc, f, line, node3d, note, oval, polyline, rect, svg,
                    text, tw)

# palettes reused across these pages
BL = dict(fill="#fff", stroke="#93c5fd", tfs=12.0, sfs=9.1, scol="#54637a")
BLH = dict(fill="#dbeafe", stroke="#2563eb", tfs=12.4, sfs=9.1, scol="#31456b")
OR = dict(fill="#fff", stroke="#fdba74", tfs=11.4, sfs=8.7, scol="#54637a")
GR = dict(fill="#fff", stroke="#86efac", tfs=11.6, sfs=8.9, scol="#54637a")
GRH = dict(fill="#dcfce7", stroke="#16a34a", tfs=11.8, sfs=8.9, scol="#14532d")
AM = dict(fill="#fff", stroke="#fcd34d", tfs=11.2, sfs=8.5, scol="#54637a")


def dn(x, y1, y2, col="#2563eb", head="ab", label=None, sw=1.7):
    return arrow(x, y1, x, y2, stroke=col, sw=sw, head=head, label=label)


# ════════════════════════════════════════════════════════ PAGE 1 — OVERVIEW ══

def page1_body():
    hero = """
<div class="hero">
  <h1>SplitX</h1>
  <div class="tag">A mobile-first group-expense platform that reduces any debt graph to the
  minimum number of settlements &mdash; delivered on a production DevOps pipeline:
  containerised, auto-scaled on Kubernetes, provisioned on AWS as code, and fully observed.</div>
  <div class="hchips">
    <span>Next.js 16 &middot; React 19</span><span>Docker</span><span>Kubernetes + HPA</span>
    <span>Terraform &middot; AWS EKS</span><span>CloudFront</span>
    <span>Jenkins &middot; GitHub Actions</span><span>Prometheus &middot; Grafana &middot; Loki</span>
  </div>
</div>"""

    cards = """
<div class="cards">
  <div class="card" style="--ac:#0d9488">
    <h3><i>P</i>Problem Statement</h3>
    <p>Shared spending produces a dense debt graph: with <b>n</b> participants each expense creates up
    to <b>n&minus;1</b> obligations, so naive settlement needs <b>O(n&sup2;)</b> transfers. Manual tracking is
    error-prone, itemised bills cannot be divided fairly by hand, and cash reconciliation leaves no
    audit trail. Equally, a feature-complete application without a reproducible build, an automated
    release path, a scaling policy or operational visibility <b>cannot be run in production</b> &mdash;
    deployments become manual, failures silent and capacity guesswork.</p>
  </div>
  <div class="card" style="--ac:#0891b2">
    <h3><i>S</i>Proposed Solution</h3>
    <p>SplitX records expenses under <b>four split strategies</b> and collapses the debt graph to the
    <b>minimum transfer set</b> using a dual-algorithm settlement engine (greedy netting benchmarked
    against exact-match pruning). Receipts are itemised by OCR and vision AI, expenses can be
    dictated by voice, and settlement hands off to UPI. The platform is delivered by an
    <b>end-to-end DevOps pipeline</b>: multi-stage container image, Kubernetes orchestration with
    horizontal pod autoscaling, Terraform-provisioned AWS infrastructure behind CloudFront, gated
    Jenkins and GitHub Actions pipelines, and a metrics + logs + alerting stack.</p>
  </div>
  <div class="card" style="--ac:#4f46e5">
    <h3><i>O</i>Objectives</h3>
    <ul>
      <li>Model group expenses and compute the <b>minimum settlement set</b> with an immutable audit trail.</li>
      <li>Package the application as a <b>reproducible, non-root, minimal-surface</b> container image.</li>
      <li>Provision the complete <b>AWS footprint declaratively</b> with Terraform and remote state.</li>
      <li>Orchestrate on Kubernetes with <b>self-healing, zero-downtime rollouts and CPU-driven HPA</b>.</li>
      <li>Automate build &rarr; test &rarr; scan &rarr; publish &rarr; deploy on <b>webhook triggers</b>, with gates that can fail the build.</li>
      <li>Instrument <b>metrics, dashboards, centralised logs and alert routing</b> end to end.</li>
    </ul>
  </div>
  <div class="card" style="--ac:#7c3aed">
    <h3><i>C</i>Scope &amp; Delimitations</h3>
    <ul>
      <li><b>In scope:</b> the web application and its container image; Kubernetes manifests and Helm chart;
      Terraform modules for VPC, EKS, ECR, S3 and CloudFront; Jenkins and GitHub Actions pipelines;
      Prometheus, Alertmanager, Grafana, Loki; GitOps reconciliation with ArgoCD.</li>
      <li><b>Out of scope:</b> native iOS/Android builds (the PWA is installable instead);
      multi-currency FX conversion; and custody of funds &mdash; UPI deep links delegate the actual
      transfer to the user&rsquo;s own payment app, so SplitX never touches money.</li>
      <li><b>Assumptions:</b> a managed PostgreSQL endpoint is reachable; AWS resources are created for
      the demonstration window and destroyed afterwards to contain cost.</li>
    </ul>
  </div>
</div>"""

    rows = [
        ("Application", ["Next.js 16 (App Router)", "React 19", "TypeScript 5", "Prisma 6",
                         "NextAuth v5", "Zod", "SWR", "Framer Motion", "Recharts",
                         "CSS Modules", "PWA / Workbox"]),
        ("Data &amp; AI", ["Neon PostgreSQL", "Upstash Redis", "Supabase Storage",
                           "Gemini 2.0 Flash", "GPT-4o-mini Vision", "Tesseract.js",
                           "Web Speech API", "Resend"]),
        ("Containers, Cloud &amp; IaC", ["Docker", "Docker Compose", "Kubernetes", "Helm",
                                          "Kustomize", "ArgoCD", "AWS EKS", "Amazon ECR",
                                          "CloudFront", "Amazon S3", "VPC / ALB",
                                          "Terraform", "Ansible"]),
        ("CI/CD &amp; Observability", ["Git + GitHub", "GitHub Actions", "Jenkins", "SonarQube",
                                        "Trivy", "Nexus", "ESLint", "Husky", "Commitlint",
                                        "Prometheus", "Alertmanager", "Grafana", "Loki",
                                        "Promtail"]),
    ]
    srows = "".join(
        f'<div class="srow"><div class="sk">{k}</div><div class="sv">'
        + "".join(f"<span>{v}</span>" for v in vals) + "</div></div>"
        for k, vals in rows)
    stack = f'<div class="stackbox"><div class="sbt">Technology Stack</div>{srows}</div>'

    stats = [("18", "Prisma data models"), ("38", "API route handlers"),
             ("19", "DevOps tools integrated"), ("12", "Jenkins pipeline stages"),
             ("2&rarr;10", "pods via HPA"), ("3-stage", "Docker image build")]
    statshtml = ('<div class="stats">'
                 + "".join(f"<div class='stat'><b>{a}</b><span>{b}</span></div>"
                           for a, b in stats) + "</div>")

    return hero + cards + stack + statshtml


# ═══════════════════════════════════════════════════ PAGE 2 — ARCHITECTURE ══

def page2_fig():
    VW, VH = 860, 1152
    root = R(5, 5, 850, 1142)
    b = root.rows(weights=[96, 138, 80, 244, 202, 106, 106, 104, 30], gap=13)
    o = []

    # ── 1 client ──
    s, i = container(b[0], "PRESENTATION LAYER — CLIENT DEVICE", lcol="#1e40af",
                     tag="Installable PWA", tagfill="#dbeafe")
    o.append(s)
    c = i.cols(3, 11)
    o.append(box(c[0], "SplitX PWA — React 19", "offline shell · service-worker cache · 18 themes · haptics", **BL))
    o.append(box(c[1], "Web Speech API", "voice-dictated expense capture, browser-native", **BL))
    o.append(box(c[2], "Tesseract.js", "on-device receipt OCR — the image never leaves the phone", **BL))
    o.append(dn(b[0].cx, b[0].y2, b[1].y - 1, label="HTTPS"))

    # ── 2 edge / CDN ──
    s, i = container(b[1], "EDGE LAYER — CONTENT DELIVERY NETWORK", lcol="#1e40af",
                     tag="Amazon CloudFront", tagfill="#dbeafe")
    o.append(s)
    rr = i.rows(weights=[40, 56], gap=16)
    cf = R(rr[0].x + rr[0].w * 0.20, rr[0].y, rr[0].w * 0.60, rr[0].h)
    o.append(box(cf, "CloudFront Distribution — 2 origins, path-based cache behaviours",
                 "HTTP/2 + HTTP/3 · TLS 1.2+ · Brotli · HSTS response-headers policy · access logs to S3",
                 **BLH))
    og = rr[1].cols(2, 16)
    o.append(box(og[0], "Origin 1 · Amazon S3 + Origin Access Control",
                 "/_next/static/* · /icons/* · /screenshots/*  —  CachingOptimized, max-age 1 year, immutable", **BL))
    o.append(box(og[1], "Origin 2 · Application Load Balancer",
                 "/api/* and server-rendered routes  —  CachingDisabled, AllViewerExceptHostHeader", **BL))
    o.append(elbow(cf.cx - 40, cf.y2, og[0].cx, og[0].y - 1, vfirst=True,
                   mid=cf.y2 + 8, stroke="#2563eb", head="ab", label="cache HIT"))
    o.append(elbow(cf.cx + 40, cf.y2, og[1].cx, og[1].y - 1, vfirst=True,
                   mid=cf.y2 + 8, stroke="#2563eb", head="ab", label="cache BYPASS"))
    o.append(dn(og[1].cx, b[1].y2, b[2].y - 1))

    # ── 3 ingress ──
    s, i = container(b[2], "INGRESS & SERVICE DISCOVERY", lcol="#1e40af",
                     tag="Layer-7 routing", tagfill="#dbeafe")
    o.append(s)
    c = i.cols(2, 16)
    o.append(box(c[0], "Ingress — AWS ALB  /  ingress-nginx locally",
                 "TLS termination · path routing · 10 MB body limit · health-check target group", **BL))
    o.append(box(c[1], "Service  splitx-service  (ClusterIP)",
                 "port 80 → targetPort 3000 · kube-proxy round-robin across ready endpoints", **BL))
    o.append(arrow(c[0].x2 + 1, c[0].cy, c[1].x - 2, c[1].cy, stroke="#2563eb", head="ab"))
    o.append(dn(c[1].cx, b[2].y2, b[3].y - 1))

    # ── 4 kubernetes ──
    s, i = container(b[3], "ORCHESTRATION LAYER — KUBERNETES  (namespace: splitx)",
                     lcol="#1e40af", tag="EKS / Kind", tagfill="#dbeafe")
    o.append(s)
    top, bot = i.rows(weights=[132, 58], gap=11)
    dep, right = top.cols(weights=[62, 38], gap=13)
    ds, di = container(dep, "Deployment  splitx  ·  RollingUpdate (maxSurge 1, maxUnavailable 0)",
                       fill="#f0f7ff", stroke="#93c5fd", dash="5 4", lcol="#1d4ed8",
                       lfs=9.4, pad=8, rx=8)
    o.append(ds)
    pods = di.cols(4, 8)
    for k, p in enumerate(pods):
        if k < 3:
            o.append(box(p, "Pod", f"splitx-7d9f8b-{'abcxyz'[k * 2:k * 2 + 3]}", sub2="1/1 Running",
                         fill="#fff", stroke="#60a5fa", tfs=10.6, sfs=7.6,
                         s2fs=7.8, s2col="#15803d"))
        else:
            o.append(box(p, "Pod n", "created by HPA", sub2="… up to 10",
                         fill="#f8fafc", stroke="#94a3b8", dash="4 3", tfs=10.6,
                         sfs=7.6, s2fs=7.8, s2col="#b45309"))
    rr = right.rows(weights=[56, 36, 36], gap=6)
    o.append(box(rr[0], "HorizontalPodAutoscaler v2",
                 "CPU 60% · memory 75% · 2 → 10 replicas", **BLH))
    o.append(box(rr[1], "metrics-server", "resource.metrics.k8s.io", fill="#fff",
                 stroke="#93c5fd", tfs=10.4, sfs=8.4))
    o.append(box(rr[2], "PodDisruptionBudget", "minAvailable: 1 · topology spread",
                 fill="#fff", stroke="#93c5fd", tfs=10.4, sfs=8.4))
    o.append(arrow(rr[1].cx, rr[1].y - 1, rr[0].cx, rr[0].y2 + 1, stroke="#d97706",
                   head="amo", dash="5 4", sw=1.5))
    o.append(arrow(rr[0].x - 2, rr[0].cy, dep.x2 + 2, rr[0].cy, stroke="#d97706",
                   head="amo", dash="5 4", sw=1.6, label="scale"))
    c = bot.cols(3, 11)
    o.append(box(c[0], "ConfigMap", "non-secret environment", fill="#fff",
                 stroke="#93c5fd", tfs=10.4, sfs=8.4))
    o.append(box(c[1], "Secret", "database URL · API tokens", fill="#fff",
                 stroke="#93c5fd", tfs=10.4, sfs=8.4))
    o.append(box(c[2], "ServiceAccount", "IRSA-annotated, least privilege", fill="#fff",
                 stroke="#93c5fd", tfs=10.4, sfs=8.4))
    o.append(dn(b[3].cx, b[3].y2, b[4].y - 1))

    # ── 5 application runtime ──
    s, i = container(b[4], "APPLICATION RUNTIME — INSIDE EACH POD", lcol="#1e40af",
                     tag="Next.js standalone · non-root uid 1001", tagfill="#dbeafe")
    o.append(s)
    ra, rb = i.rows(weights=[52, 90], gap=12)
    c = ra.cols(3, 11)
    o.append(box(c[0], "Proxy Middleware", "session guard · Redis rate limit · Prometheus timing · requestId", **BL))
    o.append(box(c[1], "Route Handlers — 38 endpoints", "REST · Zod validation · per-resource authorisation", **BL))
    o.append(box(c[2], "React Server Components", "streamed SSR · design-token theming", **BL))
    c = rb.cols(4, 9)
    o.append(box(c[0], "Settlement Engine", "greedy netting + exact-match pruning → minimum transfer set", **BLH))
    o.append(box(c[1], "Group Finance", "member balances · debt simplification · balance journey", **BL))
    o.append(box(c[2], "Transaction Parser", "UPI/SMS regex · receipt line-item extraction", **BL))
    o.append(box(c[3], "Notifications & Audit", "event fan-out · immutable audit log", **BL))
    o.append(dn(b[4].cx, b[4].y2, b[5].y - 1))

    # ── 6 data ──
    s, i = container(b[5], "DATA ACCESS & PERSISTENCE", lcol="#1e40af",
                     tag="18 models", tagfill="#dbeafe")
    o.append(s)
    c = i.cols(3, 11)
    o.append(box(c[0], "Prisma ORM 6", "type-safe client · migrations · pooled + direct URLs", **BL))
    o.append(cyl(c[1], "Neon PostgreSQL", "serverless Postgres · soft delete · audit log"))
    o.append(cyl(c[2], "Upstash Redis", "sliding-window rate limit, 50 req/min per IP"))

    # ── 7 external ──
    s, i = container(b[6], "EXTERNAL SERVICES", lcol="#1e40af", tag="Third-party APIs",
                     tagfill="#dbeafe")
    o.append(s)
    c = i.cols(5, 9)
    for r_, t_, s_ in [(c[0], "Supabase Storage", "avatars · receipt images"),
                       (c[1], "Gemini 2.0 Flash", "AI assistant · voice parsing"),
                       (c[2], "OpenAI GPT-4o-mini", "vision receipt itemisation"),
                       (c[3], "Resend", "password-reset email"),
                       (c[4], "Google / GitHub OAuth", "federated sign-in")]:
        o.append(box(r_, t_, s_, fill="#fff", stroke="#93c5fd", tfs=10.2, sfs=8.2))

    # ── 8 observability ──
    s, i = container(b[7], "CROSS-CUTTING OBSERVABILITY  (detailed on page 5)",
                     fill="#f0f9ff", stroke="#7dd3fc", dash="6 4", lcol="#0369a1",
                     tag="pull-based", tagfill="#e0f2fe")
    o.append(s)
    c = i.cols(5, 9)
    for r_, t_, s_ in [(c[0], "/api/metrics", "prom-client · 20+ series"),
                       (c[1], "Prometheus", "15 s scrape · 9 alert rules"),
                       (c[2], "Alertmanager → Webhook", "severity-routed notifications"),
                       (c[3], "Promtail → Loki", "pod-labelled log streams"),
                       (c[4], "Grafana", "4 provisioned dashboards")]:
        o.append(box(r_, t_, s_, fill="#fff", stroke="#38bdf8", tfs=10.2, sfs=8.2))

    # ── legend ──
    lg = b[8]
    lx = lg.x + 4
    o.append(line(lx, lg.cy, lx + 26, lg.cy, stroke="#2563eb", sw=1.8))
    o.append(text(lx + 31, lg.cy + 3.2, "request / response path", fs=9, weight=600, fill="#475569"))
    lx += 175
    o.append(line(lx, lg.cy, lx + 26, lg.cy, stroke="#d97706", sw=1.8, dash="5 4"))
    o.append(text(lx + 31, lg.cy + 3.2, "control / autoscaling signal", fs=9, weight=600, fill="#475569"))
    lx += 190
    o.append(rect(R(lx, lg.cy - 6, 26, 12), fill="#dbeafe", stroke="#2563eb", rx=3))
    o.append(text(lx + 31, lg.cy + 3.2, "key subsystem", fs=9, weight=600, fill="#475569"))
    lx += 130
    o.append(rect(R(lx, lg.cy - 6, 26, 12), fill="#f8fafc", stroke="#94a3b8", rx=3, dash="4 3"))
    o.append(text(lx + 31, lg.cy + 3.2, "dynamically created replica", fs=9, weight=600, fill="#475569"))

    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════ PAGE 3 — UML DEPLOYMENT / AWS CLOUD ══

def page3_fig():
    VW, VH = 860, 1160
    root = R(3, 14, 854, 1140)
    top, gap, cloud = root.rows(weights=[76, 26, 1038], gap=0)
    o = []

    # developer + github
    c = top.cols(2, 16)
    o.append(node3d(c[0].inset(top=10), "Developer Workstation",
                    "artifacts: source · Dockerfile · *.tf · Helm chart · k6 scripts",
                    stereo="device", top="#ffedd5", stroke="#c2410c"))
    o.append(node3d(c[1].inset(top=10), "GitHub — origin/main",
                    "«artifact» repository · Actions runners · webhook publisher",
                    stereo="device", top="#ffedd5", stroke="#c2410c"))
    o.append(arrow(c[0].x2 - 30, c[0].cy + 6, c[1].x + 22, c[1].cy + 6,
                   stroke="#ea580c", head="ao", sw=1.7, label="git push"))
    o.append(dn(cloud.cx, top.y2 + 2, cloud.y - 1, col="#ea580c", head="ao",
                label="terraform apply · docker push · helm upgrade"))

    # AWS cloud
    s, ci = container(cloud, "AWS CLOUD  —  «execution environment»  account 918183256068",
                      fill="#fffaf5", stroke="#f97316", sw=1.6, dash="8 5",
                      lcol="#c2410c", lfs=12, tag="managed by Terraform",
                      tagfill="#ffedd5", pad=8)
    o.append(s)
    grow, region = ci.rows(weights=[74, 934], gap=13)

    g = grow.cols(4, 10)
    for r_, st, t_, s_ in [
        (g[0], "device", "Amazon CloudFront", "global edge network · 2 origins · OAC · HTTP/3"),
        (g[1], "artifact store", "Amazon S3", "static assets · versioned · SSE · CF access logs"),
        (g[2], "artifact store", "Amazon ECR", "splitx-app images · scan-on-push · lifecycle 10"),
        (g[3], "execution environment", "IAM + OIDC", "IRSA for ALB controller · GitHub OIDC role"),
    ]:
        o.append(node3d(r_.inset(top=9), t_, s_, stereo=st, top="#fed7aa",
                        stroke="#c2410c", tfs=10.6, sfs=8.2))
    o.append(text(grow.x, grow.y2 + 9.5, "module.cdn  ·  module.ecr  ·  module.cicd",
                  fs=8.6, weight=700, fill="#c2410c"))

    s, ri = container(region, "REGION  us-east-1", fill="#fff7ed", stroke="#fb923c",
                      dash="7 4", lcol="#c2410c", lfs=11,
                      tag="module.eks + module.vpc", tagfill="#fed7aa", pad=7)
    o.append(s)
    cp, vpcr, cw = ri.rows(weights=[54, 776, 62], gap=11)
    o.append(node3d(cp.inset(top=9, left=2, right=2), "EKS Control Plane  v1.31  (AWS-managed)",
                    "API server · etcd · scheduler · controller-manager — replicated across AZs · logs to CloudWatch",
                    stereo="execution environment", top="#fed7aa", stroke="#c2410c",
                    tfs=11, sfs=8.4))

    s, vi = container(vpcr, "VPC  10.0.0.0/16  —  DNS hostnames + resolution enabled",
                      fill="#fffdf9", stroke="#fdba74", lcol="#9a3412", lfs=11.4,
                      tag="module.vpc", tagfill="#ffedd5", pad=6)
    o.append(s)
    gwr, azr = vi.rows(weights=[42, 704], gap=10)
    gg = gwr.cols(weights=[26, 26, 48], gap=9)
    o.append(box(gg[0], "Internet Gateway", "public egress / ingress", **OR))
    o.append(box(gg[1], "NAT Gateway + EIP", "private-subnet egress", **OR))
    o.append(box(gg[2], "Route Tables  ·  Security Groups  ·  VPC Flow Logs",
                 "public → IGW · private → NAT · flow logs to CloudWatch", **OR))

    az = azr.cols(2, 12)
    for k, (azr_, azn, pub, prv) in enumerate([
            (az[0], "us-east-1a", "10.0.1.0/24", "10.0.10.0/24"),
            (az[1], "us-east-1b", "10.0.2.0/24", "10.0.11.0/24")]):
        s, ai = container(azr_, f"AVAILABILITY ZONE  {azn}", fill="#fff"

                          , stroke="#fdba74", dash="6 4", lcol="#9a3412", lfs=11.0,
                          pad=5)
        o.append(s)
        pubr, prvr = ai.rows(weights=[82, 596], gap=9)
        s2, pi = container(pubr, f"Public subnet {pub}  ·  kubernetes.io/role/elb",
                           fill="#fff7ed", stroke="#fdba74", lcol="#c2410c", lfs=10.0,
                           pad=5, rx=8)
        o.append(s2)
        o.append(node3d(pi.inset(top=8), "ALB node + target group",
                        "listener 80/443 → NodePort", stereo="device", d=6,
                        top="#fed7aa", stroke="#c2410c", tfs=11.2, sfs=9.2))
        s3, si = container(prvr, f"Private subnet {prv}  ·  role/internal-elb",
                           fill="#fff7ed", stroke="#fdba74", lcol="#c2410c", lfs=10.0,
                           pad=5, rx=8)
        o.append(s3)
        ec2 = si.inset(top=9)
        o.append(node3d(ec2, None, None, stereo=None, d=7, top="#fde68a",
                        stroke="#a16207", fill="#fffdf5"))
        ei = ec2.inset(all=5, top=9)
        er = ei.rows(weights=[40, 33, 132, 33, 33, 33, 33], gap=7)
        o.append(block(er[0], [
            {"text": "«device»  EC2  t3.medium  (EKS worker node)", "fs": 10.6,
             "weight": 700, "fill": "#78350f", "max_lines": 2},
            {"text": "2 vCPU · 4 GiB · Amazon Linux 2023 · private subnet, no public IP",
             "fs": 9.0, "weight": 400, "fill": "#92400e", "max_lines": 1,
             "gap": 1.6}], pad=2))
        o.append(box(er[1], "«execution environment» kubelet + containerd",
                     None, fill="#fff", stroke="#d97706", tfs=10.0, rx=3))
        pr = er[2].rows(2, 7)
        for j, pp in enumerate(pr):
            o.append(box(pp, "«artifact»  splitx-app:a1c3f9e",
                         "Next.js standalone · non-root uid 1001 · live/ready probes",
                         sub2=f"Pod  splitx-{'7d9f8b' if j == 0 else 'b42e1c'}-x{k}{j}",
                         fill="#fffbeb", stroke="#d97706", tfs=10.2, sfs=8.8,
                         s2fs=8.6, s2col="#15803d", rx=3))
        o.append(box(er[3], "«artifact» VPC CNI · kube-proxy · CoreDNS",
                     "cluster networking and service discovery",
                     fill="#fff", stroke="#d97706", tfs=9.8, sfs=8.6, rx=3))
        o.append(box(er[4], "«artifact» AWS Load Balancer Controller · Cluster Autoscaler",
                     "IRSA service accounts — provisions the ALB, adds nodes",
                     fill="#fff", stroke="#d97706", tfs=9.8, sfs=8.6, rx=3))
        o.append(box(er[5], "«artifact» metrics-server · kube-state-metrics · EBS CSI",
                     "resource.metrics.k8s.io feeds the HPA decision",
                     fill="#fff", stroke="#d97706", tfs=9.8, sfs=8.6, rx=3))
        o.append(box(er[6], "«artifact» Promtail + node-exporter DaemonSet",
                     "one pod per node — ships logs and host metrics",
                     fill="#fff", stroke="#d97706", tfs=9.8, sfs=8.6, rx=3))

    o.append(arrow(az[0].x2 + 2, az[0].cy, az[1].x - 3, az[1].cy, stroke="#ea580c",
                   head="ao", tail="aoo", sw=1.5, label="pod network (VPC CNI)"))

    cc = cw.cols(weights=[34, 33, 33], gap=10)
    o.append(box(cc[0], "Amazon CloudWatch", "control-plane logs · ALB 5xx · CF cache-hit ratio", **OR))
    o.append(box(cc[1], "Cluster Autoscaler (IRSA)", "adds a node when pods stay Pending", **OR))
    o.append(box(cc[2], "Internet / SaaS endpoints", "Neon · Upstash · Supabase · Gemini (via NAT)", **OR))

    return svg(VW, VH, "".join(o))


# ══════════════════════════════════════════════════ PAGE 4 — CI/CD PIPELINE ══

STAGES = [
    ("1", "Checkout", "git SCM checkout; capture short commit SHA as the image tag", 0),
    ("2", "Install", "npm ci — lockfile-exact, reproducible dependency tree", 0),
    ("3", "Lint + Test", "ESLint + authorisation hardening test suite", 1),
    ("4", "Build", "next build → standalone server bundle", 0),
    ("5", "SonarQube", "quality gate; waitForQualityGate abortPipeline: true", 1),
    ("6", "Docker Build", "buildx, --build-arg GIT_SHA, layer cache reuse", 0),
    ("7", "Trivy Scan", "image CVE + secret scan; --exit-code 1 on CRITICAL", 1),
    ("8", "Publish", "push :sha and :build to Nexus (local) / Amazon ECR", 0),
    ("9", "Deploy", "helm upgrade --install --atomic --wait (auto-rollback)", 0),
    ("10", "Smoke Test", "/api/health/ready = 200 + k6 latency thresholds", 1),
    ("11", "GitOps", "bump values-*.yaml image tag, push → ArgoCD syncs", 0),
    ("12", "Notify", "archive Trivy/k6 reports; Discord webhook", 0),
]


def page4_fig_a():
    VW, VH = 860, 452
    root = R(5, 5, 850, 442)
    trig, stg, out = root.rows(weights=[62, 292, 66], gap=11)
    o = []

    t = trig.cols(5, 26)
    tl = [("Developer", "writes code, commits"),
          ("Husky + Commitlint", "pre-commit ESLint · Conventional Commit check"),
          ("GitHub  origin/main", "push event published"),
          ("Webhook → Cloudflare Tunnel", "POST /github-webhook/ in ~2 s"),
          ("Jenkins multibranch job", "GitHub hook trigger for GITScm polling")]
    for r_, (a, bb) in zip(t, tl):
        o.append(box(r_, a, bb, fill="#fffbeb", stroke="#f59e0b", tfs=10.4, sfs=8.2))
    for k in range(4):
        o.append(arrow(t[k].x2 + 2, t[k].cy, t[k + 1].x - 3, t[k + 1].cy,
                       stroke="#d97706", head="am", sw=1.6))

    s, si = container(stg, "JENKINS DECLARATIVE PIPELINE  —  12 stages, 4 hard gates",
                      fill="#fffdf7", stroke="#fbbf24", lcol="#b45309", lfs=11,
                      tag="Jenkinsfile", tagfill="#fde68a")
    o.append(s)
    cells = si.grid(2, 6, gx=8, gy=9)
    for cell, (n, ttl, dsc, gate) in zip(cells, STAGES):
        o.append(box(cell, ttl, dsc,
                     fill="#fef2f2" if gate else "#fff",
                     stroke="#ef4444" if gate else "#fcd34d",
                     tfs=10.2, sfs=7.9, scol="#54637a"))
        o.append(badge(R(cell.x + 5, cell.y + 5, 15, 15), n,
                       fill="#ef4444" if gate else "#f59e0b", fs=9))
        if gate:
            o.append(rect(R(cell.x2 - 34, cell.y + 5, 29, 12.5), fill="#ef4444",
                          stroke="none", rx=6))
            o.append(text(cell.x2 - 19.5, cell.y + 14.2, "GATE", fs=7.4, weight=800,
                          fill="#fff", anchor="middle"))
    for k in range(5):
        o.append(arrow(cells[k].x2 + 1, cells[k].cy, cells[k + 1].x - 2, cells[k + 1].cy,
                       stroke="#d97706", head="am", sw=1.3))
        o.append(arrow(cells[k + 6].x2 + 1, cells[k + 6].cy, cells[k + 7].x - 2,
                       cells[k + 6].cy, stroke="#d97706", head="am", sw=1.3))
    o.append(elbow(cells[5].cx, cells[5].y2 + 1, cells[6].cx, cells[6].y - 2,
                   vfirst=True, mid=(cells[5].y2 + cells[6].y) / 2, stroke="#d97706",
                   head="am", sw=1.3))

    ol = [("Nexus  ·  Amazon ECR  ·  GHCR", "immutable :sha tags"),
          ("helm upgrade --atomic", "rolling update, 0 downtime"),
          ("EKS  /  Kind cluster", "pods replaced 1-by-1"),
          ("k6 smoke gate", "p95 + error-rate thresholds"),
          ("GitOps commit → ArgoCD", "cluster reconciled from Git"),
          ("Discord webhook", "build result + report links")]
    c = out.cols(6, 9)
    for r_, (a, bb) in zip(c, ol):
        o.append(box(r_, a, bb, fill="#f0fdf4", stroke="#4ade80", tfs=9.8, sfs=7.8))
    for k in range(5):
        o.append(arrow(c[k].x2 + 1, c[k].cy, c[k + 1].x - 2, c[k + 1].cy,
                       stroke="#16a34a", head="ag", sw=1.4))
    o.append(dn(stg.cx, stg.y2 + 1, out.y - 2, col="#16a34a", head="ag"))
    return svg(VW, VH, "".join(o))


def page4_fig_b():
    VW, VH = 860, 250
    root = R(5, 5, 850, 240)
    o = []
    left, right = root.cols(weights=[62, 38], gap=18)

    s, li = container(left, "GITHUB ACTIONS  —  CLOUD CI/CD  (4 workflows)",
                      fill="#fffdf7", stroke="#fbbf24", lcol="#b45309", lfs=10.6,
                      tag=".github/workflows", tagfill="#fde68a")
    o.append(s)
    cells = li.grid(2, 2, gx=10, gy=9)
    wf = [("ci.yml", "Node 20/22 matrix → lint · test · build → publish image to GHCR (buildx cache, SBOM) → Trivy SARIF into GitHub Code Scanning"),
          ("cd-aws.yml", "tag / dispatch → OIDC AssumeRoleWithWebIdentity → push ECR → helm upgrade on EKS → S3 sync + CloudFront invalidation"),
          ("terraform.yml", "PR: fmt · validate · tflint · checkov · plan posted as a PR comment. apply only via dispatch behind an environment approval"),
          ("pr-checks.yml", "Conventional-Commit PR title, dependency review, gitleaks secret scan, required status checks")]
    for cell, (a, bb) in zip(cells, wf):
        o.append(box(cell, a, bb, fill="#fff", stroke="#fcd34d", tfs=10.2, sfs=7.8,
                     sub_lines=4))

    s, ri = container(right, "KEYLESS AWS ACCESS", fill="#fff7ed", stroke="#fb923c",
                      lcol="#c2410c", lfs=10.6, tag="module.cicd", tagfill="#fed7aa")
    o.append(s)
    rr = ri.rows(weights=[44, 40, 78], gap=9)
    o.append(box(rr[0], "GitHub OIDC provider", "token.actions.githubusercontent.com", **OR))
    o.append(box(rr[1], "IAM role — trust policy scoped to repo + branch",
                 "no long-lived AWS keys stored anywhere", fill="#ffedd5",
                 stroke="#ea580c", tfs=9.8, sfs=8.0))
    c = rr[2].cols(3, 7)
    for r_, t_ in [(c[0], "ECR push"), (c[1], "EKS deploy"), (c[2], "S3 + CloudFront")]:
        o.append(box(r_, t_, None, fill="#fff", stroke="#fdba74", tfs=9.0))
    o.append(dn(rr[0].cx, rr[0].y2 + 1, rr[1].y - 2, col="#ea580c", head="ao"))
    o.append(dn(rr[1].cx, rr[1].y2 + 1, rr[2].y - 2, col="#ea580c", head="ao"))
    return svg(VW, VH, "".join(o))


TOOLS = [
    ("Git + GitHub", "SCM", "Single source of truth; PR flow, protected main, signed history"),
    ("Husky", "Hooks", "Client-side git hooks — lints and blocks a bad commit before it exists"),
    ("Commitlint", "Standards", "Enforces Conventional Commits so history is machine-readable"),
    ("ESLint", "Static analysis", "Type-aware lint of TS/React; a violation fails the pipeline"),
    ("GitHub Actions", "Cloud CI", "Matrix build, GHCR publish, Trivy SARIF, keyless OIDC deploy"),
    ("Docker", "Containerisation", "3-stage build → non-root, minimal-surface runtime image"),
    ("Docker Compose", "Local stack", "10 services: app, Postgres, Redis, monitoring, CI tools"),
    ("Jenkins", "CI orchestrator", "12-stage declarative pipeline with four build-failing gates"),
    ("SonarQube", "Quality gate", "Bugs, smells, duplication; aborts the pipeline on failure"),
    ("Trivy", "Security", "Image CVE + secret scan; non-zero exit on CRITICAL findings"),
    ("Nexus", "Artifact registry", "Private Docker registry for local pipeline runs"),
    ("Terraform", "IaC", "Whole AWS footprint as code; S3 remote state with locking"),
    ("Ansible", "Config mgmt", "Idempotent host configuration of worker nodes post-provision"),
    ("Kubernetes", "Orchestration", "Self-healing, rolling updates, probes, quotas, HPA"),
    ("Helm", "Packaging", "Templated versioned releases; atomic upgrade, one-command rollback"),
    ("ArgoCD", "GitOps CD", "Continuously reconciles live cluster state against Git"),
    ("Prometheus + Alertmanager", "Metrics + alerting", "Pull scraping, recording rules, 9 alert rules, webhook routing"),
    ("Grafana", "Visualisation", "4 provisioned dashboards; metric ↔ log correlation"),
    ("Loki + Promtail", "Log aggregation", "Label-indexed centralised logs queried with LogQL"),
]


def page4_table():
    """Two side-by-side matrices: tool + category stacked, role wrapping freely."""
    half = (len(TOOLS) + 1) // 2

    def tbl(items):
        rows = "".join(
            f'<tr><td class="k"><b>{esc(a)}</b><i>{esc(b)}</i></td>'
            f'<td class="r">{esc(c)}</td></tr>'
            for a, b, c in items)
        return (f'<table class="tm tools"><colgroup><col class="w1"><col class="w2">'
                f'</colgroup><thead><tr><th>Tool &middot; category</th>'
                f'<th>Concrete role in SplitX</th></tr></thead>'
                f'<tbody>{rows}</tbody></table>')

    return (f'<div class="twocol" style="gap:3.4mm">{tbl(TOOLS[:half])}'
            f'{tbl(TOOLS[half:])}</div>')


# ═════════════════════════ PAGE 5 — OBSERVABILITY + KUBERNETES AUTOSCALING ══

def page5_fig_a():
    VW, VH = 860, 364
    root = R(5, 5, 850, 354)
    o = []
    main, gold = root.rows(weights=[292, 50], gap=12)
    src, mid, snk = main.cols(weights=[30, 38, 32], gap=26)

    s, si = container(src, "SIGNAL SOURCES", fill="#f0fdf4", stroke="#86efac",
                      lcol="#15803d", lfs=10.4, tag="exporters", tagfill="#dcfce7")
    o.append(s)
    sr = si.rows(weights=[74, 46, 46, 46], gap=8)
    o.append(box(sr[0], "SplitX Pods × N", "/api/metrics — prom-client registry, 20+ series · stdout JSON logs carrying requestId", **GRH))
    o.append(box(sr[1], "kube-state-metrics", "HPA replicas, pod phase, restarts", **GR))
    o.append(box(sr[2], "metrics-server", "pod & node CPU / memory", **GR))
    o.append(box(sr[3], "node-exporter", "host CPU, memory, disk, network", **GR))

    s, mi = container(mid, "COLLECTION, STORAGE & ALERT ROUTING", fill="#f0fdf4",
                      stroke="#86efac", lcol="#15803d", lfs=10.4, tag="TSDB + log store",
                      tagfill="#dcfce7")
    o.append(s)
    mr = mi.rows(weights=[76, 50, 50, 56], gap=8)
    o.append(box(mr[0], "Prometheus", "15 s scrape · ServiceMonitor discovery · recording rules · 9 alert rules · 7-day TSDB", **GRH))
    o.append(box(mr[1], "Promtail", "Kubernetes SD → pod / namespace / container labels", **GR))
    o.append(box(mr[2], "Loki", "label index · LogQL · 7-day retention · compactor", **GR))
    o.append(box(mr[3], "Alertmanager", "group · dedupe · inhibit · route by severity", **GRH))
    o.append(arrow(mr[0].cx, mr[0].y2 + 1, mr[3].cx - 60, mr[3].y - 2, stroke="#16a34a",
                   head="ag", sw=1.5, curve=(-58, 0), label="firing"))
    o.append(arrow(mr[1].cx + 60, mr[1].y2 + 1, mr[2].cx + 60, mr[2].y - 2,
                   stroke="#16a34a", head="ag", sw=1.5))

    s, ki = container(snk, "CONSUMPTION", fill="#f0fdf4", stroke="#86efac",
                      lcol="#15803d", lfs=10.4, tag="dashboards + notifications",
                      tagfill="#dcfce7")
    o.append(s)
    kr = ki.rows(weights=[104, 56, 56], gap=8)
    o.append(box(kr[0], "Grafana — 4 dashboards",
                 "Overview (HTTP rate, p95, error ratio) · Kubernetes & HPA (replicas vs CPU) · Logs (LogQL live stream) · CI/CD",
                 **GRH))
    o.append(box(kr[1], "Discord webhook", "critical + warning alerts within ~60 s", **GR))
    o.append(box(kr[2], "Amazon CloudWatch", "ALB 5xx · CloudFront cache-hit ratio · flow logs", **GR))

    for a, bx in [(sr[0], mr[0]), (sr[1], mr[0]), (sr[2], mr[0]), (sr[3], mr[0])]:
        o.append(arrow(a.x2 + 1, a.cy, bx.x - 2, min(max(a.cy, bx.y + 8), bx.y2 - 8),
                       stroke="#16a34a", head="ag", sw=1.3))
    o.append(arrow(sr[0].x2 + 1, sr[0].y2 - 12, mr[1].x - 2, mr[1].cy,
                   stroke="#0891b2", head="ac", sw=1.4, dash="5 4", label="logs"))
    o.append(arrow(mr[0].x2 + 1, mr[0].cy, kr[0].x - 2, kr[0].y + 24,
                   stroke="#16a34a", head="ag", sw=1.4, label="PromQL"))
    o.append(arrow(mr[2].x2 + 1, mr[2].cy, kr[0].x - 2, kr[0].y2 - 20,
                   stroke="#0891b2", head="ac", sw=1.4, label="LogQL"))
    o.append(arrow(mr[3].x2 + 1, mr[3].cy, kr[1].x - 2, kr[1].cy, stroke="#dc2626",
                   head="ar", sw=1.5))

    s, gi = container(gold, "GOLDEN SIGNALS TRACKED", fill="#fff", stroke="#bbf7d0",
                      lcol="#15803d", lfs=9.6, pad=9)
    o.append(s)
    gc = gi.cols(4, 10)
    for r_, t_, s_ in [(gc[0], "Latency", "p50 / p95 / p99 histogram"),
                       (gc[1], "Traffic", "requests · s⁻¹ by route"),
                       (gc[2], "Errors", "5xx ÷ total, 5 m window"),
                       (gc[3], "Saturation", "CPU vs HPA target · heap · event-loop lag")]:
        o.append(box(r_, t_, s_, fill="#f0fdf4", stroke="#86efac", tfs=9.6, sfs=7.8, rx=6))
    return svg(VW, VH, "".join(o))


def page5_fig_b():
    VW, VH = 430, 447
    root = R(5, 5, 420, 437)
    o = []
    s, i = container(root, "HPA CONTROL LOOP", fill="#f0fdf4", stroke="#86efac",
                     lcol="#15803d", lfs=10.2, tag="every 15 s",
                     tagfill="#dcfce7", pad=9)
    o.append(s)
    top, calc = i.rows(weights=[286, 84], gap=26)
    top = R(top.x + 16, top.y, top.w - 32, top.h)          # room for the return path
    g = top.grid(3, 2, gx=30, gy=22)
    lab = [("1  Pod CPU usage", "kubelet / cAdvisor"),
           ("2  metrics-server", "aggregated metrics API"),
           ("4  desiredReplicas", "ceil(cur × util ÷ target)"),
           ("3  HPA controller", "reads metrics.k8s.io"),
           ("5  Deployment", "patches ReplicaSet"),
           ("6  Pods added / removed", "scheduler binds new pods")]
    order = [0, 1, 3, 2, 4, 5]
    for idx, (t_, s_) in zip(order, lab):
        o.append(box(g[idx], t_, s_, fill="#fff", stroke="#4ade80", tfs=9.8, sfs=7.9))
    o.append(arrow(g[0].x2 + 1, g[0].cy, g[1].x - 2, g[1].cy, stroke="#16a34a", head="ag", sw=1.5))
    o.append(arrow(g[1].cx, g[1].y2 + 1, g[3].cx, g[3].y - 2, stroke="#16a34a", head="ag", sw=1.5))
    o.append(arrow(g[3].x - 2, g[3].cy, g[2].x2 + 1, g[2].cy, stroke="#16a34a", head="ag", sw=1.5))
    o.append(arrow(g[2].cx, g[2].y2 + 1, g[4].cx, g[4].y - 2, stroke="#16a34a", head="ag", sw=1.5))
    o.append(arrow(g[4].x2 + 1, g[4].cy, g[5].x - 2, g[5].cy, stroke="#16a34a", head="ag", sw=1.5))

    # closed-loop return: right of step 6 -> down -> across -> up into step 1
    rx_, by_, lx_ = g[5].x2 + 13, g[5].y2 + 13, g[0].x - 13
    o.append(polyline([(g[5].x2 + 1, g[5].cy), (rx_, g[5].cy), (rx_, by_),
                       (lx_, by_), (lx_, g[0].cy), (g[0].x - 2, g[0].cy)],
                      stroke="#d97706", sw=1.5, dash="5 4", head="am"))
    o.append(rect(R((rx_ + lx_) / 2 - 46, by_ - 7.5, 92, 15), fill="#f0fdf4",
                  stroke="none", rx=4))
    o.append(text((rx_ + lx_) / 2, by_ + 3.4, "closed feedback loop", fs=8.6,
                  weight=700, fill="#b45309", anchor="middle"))

    o.append(rect(calc, fill="#fff", stroke="#4ade80", rx=7, sw=1.2))
    o.append(text(calc.x + 11, calc.y + 15, "SCALE-OUT DECISION AT t = 75 s",
                  fs=8.6, weight=700, fill="#15803d", ls=0.7))
    o.append(f'<text x="{f(calc.cx)}" y="{f(calc.y + 37)}" font-size="12.4" '
             f'font-weight="800" fill="#0f172a" text-anchor="middle" '
             f'font-family="Cascadia Code,Consolas,monospace">'
             f'desired = ceil(2 × 212 ÷ 60) = 8</text>')
    o.append(text(calc.cx, calc.y + 55, "current replicas × current utilisation "
                  "÷ target utilisation", fs=8, weight=600, fill="#64748b",
                  anchor="middle"))
    o.append(text(calc.cx, calc.y + 70, "capped by maxReplicas = 10 and the "
                  "100 % / 15 s scale-up policy", fs=8, weight=600, fill="#64748b",
                  anchor="middle"))
    return svg(VW, VH, "".join(o))


CPU = [(0, 4), (30, 5), (42, 6), (52, 96), (62, 168), (75, 212), (88, 196),
       (96, 141), (110, 132), (122, 106), (136, 99), (150, 79), (164, 74),
       (180, 59), (210, 56), (238, 55), (248, 12), (300, 5), (360, 4), (420, 5),
       (470, 6), (520, 5), (560, 4), (600, 4)]
REP = [(0, 2), (78, 2), (78, 4), (104, 4), (104, 6), (134, 6), (134, 8),
       (162, 8), (162, 10), (372, 10), (372, 6), (432, 6), (432, 4), (492, 4),
       (492, 2), (600, 2)]


def page5_fig_c():
    VW, VH = 860, 300
    o = []
    pl = R(78, 34, 700, 208)
    o.append(rect(pl, fill="#fbfdff", stroke="#cbd5e1", rx=5))

    def px(t):
        return pl.x + pl.w * t / 600.0

    def pyc(v):
        return pl.y2 - pl.h * min(v, 240) / 240.0

    def pyr(v):
        return pl.y2 - pl.h * v / 12.0

    for v in (0, 60, 120, 180, 240):
        y = pyc(v)
        o.append(line(pl.x, y, pl.x2, y, stroke="#e6ebf1", sw=0.9))
        o.append(text(pl.x - 6, y + 3, f"{v}%", fs=8.4, weight=600, fill="#dc2626",
                      anchor="end"))
    for v in (0, 2, 4, 6, 8, 10, 12):
        o.append(text(pl.x2 + 6, pyr(v) + 3, str(v), fs=8.4, weight=600,
                      fill="#1d4ed8"))
    for t in range(0, 601, 60):
        o.append(line(px(t), pl.y2, px(t), pl.y2 + 4, stroke="#94a3b8", sw=0.9))
        o.append(text(px(t), pl.y2 + 15, f"{t // 60}", fs=8.4, weight=600,
                      fill="#64748b", anchor="middle"))
    o.append(text(pl.cx, pl.y2 + 30, "elapsed time (minutes)", fs=9, weight=700,
                  fill="#475569", anchor="middle"))
    o.append(f'<text x="{f(pl.x - 46)}" y="{f(pl.cy)}" transform="rotate(-90 '
             f'{f(pl.x - 46)} {f(pl.cy)})" font-size="9" font-weight="700" '
             f'fill="#dc2626" text-anchor="middle">CPU utilisation (avg / pod)</text>')
    o.append(f'<text x="{f(pl.x2 + 30)}" y="{f(pl.cy)}" transform="rotate(90 '
             f'{f(pl.x2 + 30)} {f(pl.cy)})" font-size="9" font-weight="700" '
             f'fill="#1d4ed8" text-anchor="middle">ready replicas</text>')

    y60 = pyc(60)
    o.append(line(pl.x, y60, pl.x2, y60, stroke="#dc2626", sw=1.4, dash="7 4"))
    o.append(rect(R(pl.x + 6, y60 - 14, 118, 13), fill="#fff", stroke="none", rx=3))
    o.append(text(pl.x + 8, y60 - 4, "HPA target — CPU 60 %", fs=8.4, weight=700,
                  fill="#dc2626"))

    for t, lb, col in [(45, "k6 ramp starts · 200 VUs", "#7c3aed"),
                       (240, "load stops", "#7c3aed"),
                       (372, "scale-in after 120 s stabilisation", "#0891b2")]:
        o.append(line(px(t), pl.y, px(t), pl.y2, stroke=col, sw=1.1, dash="4 4"))
        w = tw(lb, 8) + 8
        ax = min(px(t) + 4, pl.x2 - w - 2)
        o.append(rect(R(ax, pl.y + 2, w, 12.5), fill="#fff", stroke="none", rx=3, opacity=0.92))
        o.append(text(ax + 4, pl.y + 11.4, lb, fs=8, weight=700, fill=col))

    d = " ".join(f"{'M' if k == 0 else 'L'}{f(px(t))},{f(pyc(v))}"
                 for k, (t, v) in enumerate(CPU))
    o.append(f'<path d="{d}" fill="none" stroke="#dc2626" stroke-width="2.1" '
             f'stroke-linejoin="round"/>')
    d = " ".join(f"{'M' if k == 0 else 'L'}{f(px(t))},{f(pyr(v))}"
                 for k, (t, v) in enumerate(REP))
    o.append(f'<path d="{d}" fill="none" stroke="#1d4ed8" stroke-width="2.3" '
             f'stroke-linejoin="miter"/>')
    for t, v in [(78, 4), (104, 6), (134, 8), (162, 10), (372, 6), (432, 4), (492, 2)]:
        o.append(f'<circle cx="{f(px(t))}" cy="{f(pyr(v))}" r="3.1" fill="#fff" '
                 f'stroke="#1d4ed8" stroke-width="1.7"/>')

    lg = R(pl.x, 5, pl.w, 22)
    o.append(line(lg.x, lg.cy, lg.x + 24, lg.cy, stroke="#dc2626", sw=2.1))
    o.append(text(lg.x + 29, lg.cy + 3.2, "CPU utilisation (average across ready pods)",
                  fs=8.8, weight=600, fill="#475569"))
    o.append(line(lg.x + 300, lg.cy, lg.x + 324, lg.cy, stroke="#1d4ed8", sw=2.3))
    o.append(text(lg.x + 329, lg.cy + 3.2, "ready replicas (HPA-driven, min 2 / max 10)",
                  fs=8.8, weight=600, fill="#475569"))
    return svg(VW, VH, "".join(o))


TERM = """<div class="term"><span class="m">$</span> <span class="w">kubectl get hpa splitx-hpa -n splitx -w</span>
NAME        REFERENCE      TARGETS       MIN MAX <span class="t">REP</span>
splitx-hpa  Deploy/splitx  cpu: <span class="g">4%</span>/60%   2   10  <span class="t">2</span>
splitx-hpa  Deploy/splitx  cpu: <span class="r">212%</span>/60% 2   10  <span class="t">2</span>
splitx-hpa  Deploy/splitx  cpu: <span class="r">212%</span>/60% 2   10  <span class="t">4</span>
splitx-hpa  Deploy/splitx  cpu: <span class="r">141%</span>/60% 2   10  <span class="t">6</span>
splitx-hpa  Deploy/splitx  cpu: <span class="y">106%</span>/60% 2   10  <span class="t">8</span>
splitx-hpa  Deploy/splitx  cpu: <span class="y">79%</span>/60%  2   10  <span class="t">10</span>
splitx-hpa  Deploy/splitx  cpu: <span class="g">55%</span>/60%  2   10  <span class="t">10</span>
splitx-hpa  Deploy/splitx  cpu: <span class="g">4%</span>/60%   2   10  <span class="t">2</span>
<span class="m">$</span> <span class="w">kubectl get pods -n splitx -o wide</span>
NAME               READY  STATUS   NODE
splitx-7d9f8b-abc  <span class="g">1/1</span>    Running  <span class="c">worker-1</span>
splitx-7d9f8b-cxy  <span class="g">1/1</span>    Running  <span class="c">worker-2</span>
splitx-7d9f8b-x00  <span class="g">1/1</span>    Running  <span class="c">worker-1</span>
splitx-7d9f8b-yz1  <span class="y">0/1</span>    <span class="y">Pending</span>  <span class="m">&lt;none&gt;</span>
<span class="m"># topologySpread keeps replicas even across nodes</span>
<span class="m">$</span> <span class="w">k6 run loadtest/k6/ramp.js</span>
  <span class="c">checks</span>...........: <span class="g">100.00%</span> &#10003; 41812 &#10005; 0
  <span class="c">http_req_duration</span>: avg=118ms  p(95)=<span class="g">412ms</span>
  <span class="c">http_req_failed</span>..: <span class="g">0.00%</span>   &#10003; 0 &#10005; 41812
  <span class="c">iterations</span>.......: 41812    <span class="y">174.2/s</span>
<span class="m">#</span> <span class="g">0 failed requests during the rollout</span></div>"""
