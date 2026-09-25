# The control room on a running cluster

Written by `scripts/ops-verify.mjs` on 2026-09-25, in kind-e2e run 36094752475.
Every line is an answer from the app, as an operator's browser gets it, and through it from ops-api and the traffic lab.

## Result

| Check | Result | Detail |
|---|---|---|
| Only an operator reads the cluster through the app | pass | signed out: HTTP 401; a signed-in visitor: HTTP 403; the operator: HTTP 200 |
| ops-api answered the app | pass | ops-api in the cluster, read 2026-09-25T04:48:02.278Z |
| The nodes reading has its source's data | pass | Kubernetes API: nodes, and metrics-server |
| The workloads reading has its source's data | pass | Kubernetes API: the application's pods |
| The servingPods reading has its source's data | pass | Prometheus: requests per pod |
| The autoscaler reading has its source's data | pass | Kubernetes API: the HorizontalPodAutoscaler |
| The traffic reading has its source's data | pass | Prometheus: the service dashboard's queries |
| The admissions reading has its source's data | pass | Prometheus: Kyverno's admission requests, last 24 h |
| The alerts reading has its source's data | pass | Alertmanager |
| The logs reading has its source's data | pass | Loki: the application's log, last 15 minutes |
| The delivery reading has its source's data | pass | Prometheus: Jenkins' metrics |
| The evidence reading has its source's data | pass | Nexus: splitx-evidence |
| The lab reading has its source's data | pass | the traffic lab |
| The platform reading has its source's data | pass | the platform's facts, as cluster-up passed them |
| The AWS readings say why they are unavailable here, rather than showing anything | pass | stacks: no AWS role here: only the EKS platform gives ops-api one (EKS Pod Identity); eks: no AWS role here: only the EKS platform gives ops-api one (EKS Pod Identity); edge: no AWS role here: only the EKS platform gives ops-api one (EKS Pod Identity); budget: no AWS role here: only the EKS platform |
| Kyverno's admission counts reach the page (its metrics, scraped by Prometheus) | pass | 43 allowed and 0 refused in the last 24 hours |
| The lab accepted a run of 30 plans a second for 180 s | pass | HTTP 202 |
| A second run is refused while one is going | pass | HTTP 409 |
| The app refuses a rate above the lab's cap | pass | rate 31: HTTP 400 |
| The run finished, and what it sent was served or refused on purpose | pass | 5384 requests: 5376 served, 8 refused on purpose (rate limits, load shedding), 0 failed; p95 148 ms |
| The autoscaler asked for more pods while the lab ran | pass | wanted 2 before, at most 10 during the run (between 2 and 10); up to 10 pods answered at once |
| Prometheus saw the load the lab sent | pass | peak 60.2 requests a second on the page's chart |
| Its evidence is in Nexus, complete | pass | e66a699d0229/6653852657: deployment.json, sbom.cdx.json, vuln.json |
| Jenkins' own build metrics reach the page, through Prometheus | pass | its last build: failure, 181 s |

## The traffic lab's run, every 5 seconds

| Time (UTC) | Lab | Elapsed (s) | Pods | Wanted | Answering | Requests/s |
|---|---|---|---|---|---|---|
| 04:48:08 | running | 6 | 2 | 2 | 1 | 0.2 |
| 04:48:14 | running | 11 | 2 | 2 | 1 | 0.3 |
| 04:48:19 | running | 17 | 2 | 2 | 1 | 0.3 |
| 04:48:24 | running | 22 | 2 | 2 | 1 | 10.5 |
| 04:48:35 | running | 22 | 2 | 2 | 0 | 0 |
| 04:48:40 | running | 38 | 2 | 6 | 2 | 34.9 |
| 04:48:45 | running | 43 | 2 | 6 | 2 | 39.4 |
| 04:48:53 | running | 50 | 6 | 9 | 2 | 42.6 |
| 04:48:59 | running | 56 | 6 | 9 | 4 | 49.7 |
| 04:49:04 | running | 62 | 9 | 9 | 4 | 54 |
| 04:49:10 | running | 67 | 9 | 9 | 6 | 54.4 |
| 04:49:15 | running | 73 | 9 | 9 | 7 | 51 |
| 04:49:20 | running | 78 | 9 | 9 | 9 | 59.5 |
| 04:49:26 | running | 83 | 9 | 9 | 9 | 49.3 |
| 04:49:31 | running | 89 | 9 | 9 | 9 | 53.9 |
| 04:49:36 | running | 94 | 9 | 10 | 9 | 58.4 |
| 04:49:42 | running | 99 | 9 | 10 | 9 | 58 |
| 04:49:48 | running | 105 | 10 | 10 | 9 | 57.9 |
| 04:49:53 | running | 111 | 10 | 10 | 9 | 58.8 |
| 04:49:58 | running | 116 | 10 | 10 | 10 | 58.3 |
| 04:50:04 | running | 121 | 10 | 10 | 10 | 60.1 |
| 04:50:09 | running | 127 | 10 | 10 | 10 | 60 |
| 04:50:14 | running | 132 | 10 | 10 | 10 | 59.6 |
| 04:50:19 | running | 137 | 10 | 10 | 10 | 59.6 |
| 04:50:25 | running | 143 | 10 | 10 | 10 | 59.4 |
| 04:50:30 | running | 148 | 10 | 10 | 10 | 59.6 |
| 04:50:35 | running | 153 | 10 | 10 | 10 | 59.8 |
| 04:50:41 | running | 158 | 10 | 10 | 10 | 60.2 |
| 04:50:46 | running | 164 | 10 | 10 | 10 | 60.2 |
| 04:50:52 | running | 169 | 10 | 10 | 10 | 60.2 |
| 04:50:57 | running | 175 | 10 | 10 | 10 | 60.2 |
| 04:51:02 | running | 180 | 10 | 10 | 10 | 60.2 |
| 04:51:08 | finished | 180 | 10 | 10 | 10 | 59.1 |

The cluster had 3 nodes: splitx-control-plane (CPU 5 %, memory 14 %), splitx-worker (CPU 3 %, memory 9 %), splitx-worker2 (CPU 3 %, memory 27 %).
