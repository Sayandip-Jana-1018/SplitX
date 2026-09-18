# Kubernetes — what the rehearsal cluster proves

Written by `scripts/cluster-verify.mjs` (`npm run k8s:verify`) on 2026-09-18.
Every number here was measured against a running cluster; nothing is asserted about a YAML file.

## Result

| Check | Result | Detail |
|---|---|---|
| Replicas are spread across both worker nodes | pass | 2 pods on splitx-worker, splitx-worker2 |
| No application pod runs on the control plane | pass | control plane carries ingress-nginx and the Kubernetes components only |
| Every app pod can open new connections (DNS, Postgres, Redis) | pass | 2 pods checked |
| kindnet keeps up: no CPU quota, no memory-limit hits, nothing left waiting for a verdict | pass | 682 new flows judged since kindnet started, 0 dropped |
| The application is served on http://localhost/ | pass | HTTP 200 |
| Operational endpoints are refused at the edge | pass | /api/metrics 403, /api/health/ready 403 (B-011) |
| Liveness stays reachable for a load balancer | pass | HTTP 200 |
| The running pod reports the commit it was built from | pass | git_sha 570fcf134d20, version 0.1.0+570fcf134d20 |
| Metrics are readable inside the cluster, with the token | pass | 2 info series |
| The rate limiter is using the in-cluster Redis | pass | splitx_rate_limiter_info{backend="redis"} |
| Metrics without the token are refused even from inside the pod | pass | wget: server returned error: HTTP/1.1 401 Unauthorized |
| The schema Job built a real database | pass | 18 tables in the public schema |
| A write through the ingress reaches Postgres | pass | POST /api/register -> 201, row found in the User table, then removed |
| The settlement preview runs on the cluster | pass | 400 members planned in 12.07 ms by splitx-75cc8794bb-vttx7 (32 ms round trip) |
| The namespace refuses a privileged pod | pass | rejected by PodSecurity admission |
| A pod in another namespace cannot reach the app, the database or Redis | pass | wget: download timed out app=1 postgres=1 redis=1 (non-zero = refused) |
| The autoscaler is reading real CPU from metrics-server | pass | 2% of the 250m request, target 60% |
| A disruption budget protects the deployment | pass | 2 healthy, 1 disruption allowed at a time |
| Readiness fails when the database is gone | pass | every replica left the Service; 0 ready endpoints remain |
| Liveness does NOT restart the pods during a database outage | pass | restart count stayed at 0 (B-005) |
| The same pods serve again once the database is back | pass | no pod was replaced; restart count 0 |
| The rollout completed | pass | deployment "splitx" successfully rolled out |
| Every pod was replaced | pass | 2 old pods gone, 2 new pods serving |
| No request was lost while every pod was replaced | pass | 2950 requests in 7.1 s: 2950 OK, 0 non-200, 0 failed |
| Traffic settles on the new pods | pass | within 1076 ms of the rollout completing; 3 pod(s) answered during it |
| Prometheus scrapes every ready application pod, with the metrics token | pass | 2 of 2 ready pods scraped |
| Every scrape target is up | pass | 27 targets in 13 jobs |
| The SplitX alert rules are loaded, and every rule evaluates cleanly | pass | 6 of 6 SplitX rules loaded; 221 rules in total, 0 with errors |
| Alertmanager receives what Prometheus fires | pass | Watchdog, which fires all the time by design, is in Alertmanager |
| No alert is firing apart from Watchdog | pass | nothing needs attention |
| Alerts are routed to email, and every email was accepted | pass | 0 notification(s) sent through Gmail and 0 failed since Alertmanager started at 2026-09-18 09:55 UTC |
| Grafana serves the committed dashboards, and every data source they name exists | pass | SplitX · Logs (7 panels), SplitX · Service (28 panels); data sources loki, prometheus |
| Every dashboard query runs, and reads metrics that exist | pass | 39 queries on 30 metrics |
| Every application pod is logging to Loki | pass | 2 of 2 pods have lines in the last 15 minutes, all found within 0 s |
| One request can be followed in Loki from the ingress to the pod that served it | pass | X-Request-Id b18a0cb0b757d2564b04a8eff57f1b8b: ingress-nginx sent it to 10.244.1.16:3000 (0.044 s at the edge), and splitx-7ccd6f8b66-4bgwm at 10.244.1.16 logged the same ID |
| Every log dashboard query runs | pass | 6 LogQL queries |

## The cluster

`kind` 1 control plane + 2 workers, Kubernetes v1.35.0, pinned by digest in `k8s/kind/cluster.yaml`.
The version matches the EKS version the demo will run, so the rehearsal is not a different Kubernetes.

| Release | Chart | App version | Namespace |
|---|---|---|---|
| `alloy` | alloy-1.12.1 | v1.19.2 | monitoring |
| `ingress-nginx` | ingress-nginx-4.15.1 | 1.15.1 | ingress-nginx |
| `kube-prometheus-stack` | kube-prometheus-stack-91.4.1 | v0.94.0 | monitoring |
| `loki` | loki-7.3.0 | 3.6.12 | monitoring |
| `metrics-server` | metrics-server-3.14.0 | 0.9.0 | kube-system |

Both are pinned in `helm/platform/charts.json` and configured from a values file per component,
so the same command produces the same cluster on any machine.

## One base, two environments

`k8s/base` holds what does not change. `k8s/overlays/local` renders 21 objects (it adds the
in-cluster Postgres and Redis components); `k8s/overlays/aws` renders 16 (Neon instead of a
database pod, an ALB instead of nginx, IRSA on the ServiceAccount, two proxy hops instead of one).
Render either with `kubectl kustomize k8s/overlays/<name>`.

| Setting | Value | Why |
|---|---|---|
| CPU request | 250m | what the autoscaler measures against |
| CPU limit | none | a 1-CPU quota made V8's compiler and GC threads compete with the main thread; fresh pods stalled for up to 21 s under overload (D-053) |
| Memory request / limit | 256Mi / 512Mi | measured from a running pod, not guessed |
| Root filesystem | read-only | with `/tmp` and the Next cache as the only writable paths |
| User | 1001 (non-root) | enforced by the namespace, not just requested |

## Where the pods run

| Node | Role | Kubelet |
|---|---|---|
| `splitx-control-plane` | control-plane | v1.35.0 |
| `splitx-worker` | worker | v1.35.0 |
| `splitx-worker2` | worker | v1.35.0 |

| Pod | Node | Pod IP | Restarts |
|---|---|---|---|
| `splitx-75cc8794bb-rgz6m` | splitx-worker2 | 10.244.2.11 | 0 |
| `splitx-75cc8794bb-vttx7` | splitx-worker | 10.244.1.14 | 0 |

## kindnet, the network-policy engine

The first packet of every new pod connection waits in netfilter queue 101 for kindnet to apply the
network policies. Kind limits kindnet to 100m CPU and 50Mi by default, and at those
limits new connections timed out in that queue (D-050). Counted since each kindnet container started.

| Node | CPU quota | Throttled periods | Memory (peak) of limit | Limit hits | New flows judged | Waiting | Dropped |
|---|---|---|---|---|---|---|---|
| `splitx-control-plane` | max | 0 of 0 | 75 MiB (79) of 256 MiB | 0 | 0 | 0 | 0 |
| `splitx-worker` | max | 0 of 0 | 74 MiB (79) of 256 MiB | 0 | 341 | 0 | 0 |
| `splitx-worker2` | max | 0 of 0 | 74 MiB (79) of 256 MiB | 0 | 341 | 0 | 0 |

## What the edge exposes

| Path | Status through ingress-nginx | Why |
|---|---|---|
| `/` | 200 | the application |
| `/login` | 200 | a real page, not just the root |
| `/api/health/live` | 200 | a load balancer has to be able to ask |
| `/api/health/ready` | 403 | queries the database on every call — kubelet only |
| `/api/metrics` | 403 | token-protected, and not published at all |

## The application, not just the pods

| Check | Result |
|---|---|
| Tables created by the schema Job | 18 |
| `POST /api/register` through ingress-nginx | HTTP 201, row written to Postgres and removed again |
| `POST /api/settlements/preview` (400 members) | HTTP 200, planned in 12.07 ms |

The preview is the endpoint phase 4 will use to drive the autoscaler: it is pure CPU with
no database behind it, so a pod under load is doing arithmetic, not waiting on Neon.

## Network policy, tested from outside the namespace

A `busybox` pod in the `default` namespace tried three connections that the policies forbid.
A non-zero exit code means the connection never completed.

```
wget: download timed out
app=1
postgres=1
redis=1
```

The positive control is the application itself: its readiness probe passes, which means it
is reaching Postgres, and the page loads through ingress-nginx, which the policy does allow.

## What a database outage does

The Postgres StatefulSet was scaled to zero with the application running, then back to one.

| | Before | During the outage | After |
|---|---|---|---|
| Ready replicas | 2 | 0 | 2 |
| Ready endpoints behind the Service | 2 | 0 | 2 |
| Container restarts (total) | 0 | 0 | 0 |
| `GET /` through the ingress | 200 | 503 | 200 |
| `GET /api/health/live` | 200 | 503 | 200 |

This is the split the probes were written for. Readiness takes a pod out of the Service the
moment it cannot serve, so the ingress answers 503 instead of a broken page; liveness ignores the
database entirely, so a database problem never turns into a restart loop across every replica.

## A release with no dropped requests

`kubectl rollout restart` with four concurrent clients hitting the ingress throughout.
The deployment uses `maxSurge: 1, maxUnavailable: 0`, so a new pod must pass its readiness
probe before an old one is taken out, and a `preStop` sleep of 5 s gives ingress-nginx time
to stop routing to a pod before its server begins shutting down.

| | |
|---|---|
| Requests during the release | 2950 in 7.1 s |
| HTTP 200 | 2950 |
| Non-200 responses | 0 |
| Connection failures | 0 |
| Pods that answered | 3 |
| Traffic fully on the new pods | 1076 ms after the rollout reported complete |

Requests answered per pod (the name comes from the pod itself, through the downward API).
nginx reuses upstream connections, so a short rollout can be served mostly by one pod; what
matters is that the pods serving afterwards are the new ones:

```
splitx-75cc8794bb-vttx7  1644
splitx-75cc8794bb-rgz6m  1102
splitx-7ccd6f8b66-4bgwm  204
```

## Monitoring

kube-prometheus-stack (Prometheus Operator, Prometheus, Alertmanager, Grafana, kube-state-metrics,
node-exporter) runs in its own namespaces. The application ships its own ServiceMonitor and
alert rules (`k8s/base`), and its dashboards come from `monitoring/dashboards`.

| Scrape job | Namespace | Targets up |
|---|---|---|
| `alloy` | monitoring | 1 of 1 |
| `apiserver` | default | 1 of 1 |
| `coredns` | kube-system | 2 of 2 |
| `ingress-nginx-controller-metrics` | ingress-nginx | 1 of 1 |
| `kube-prometheus-stack-alertmanager` | monitoring | 2 of 2 |
| `kube-prometheus-stack-grafana` | monitoring | 1 of 1 |
| `kube-prometheus-stack-operator` | monitoring | 1 of 1 |
| `kube-prometheus-stack-prometheus` | monitoring | 2 of 2 |
| `kube-state-metrics` | monitoring | 1 of 1 |
| `kubelet` | kube-system | 9 of 9 |
| `monitoring/loki` | monitoring | 1 of 1 |
| `node-exporter` | node-exporter | 3 of 3 |
| `splitx` | splitx | 2 of 2 |

| SplitX alert | Severity | State now |
|---|---|---|
| `SplitXDown` | critical | pending |
| `SplitXSheddingLoad` | warning | inactive |
| `SplitXSlowResponses` | warning | inactive |
| `SplitXEventLoopBlocked` | warning | inactive |
| `SplitXRateLimiterUnavailable` | warning | inactive |
| `SplitXServerErrors` | critical | inactive |

Each SplitX rule is unit-tested with promtool in CI (`npm run test:alerts`), against series
that should fire it and series that must not. 221 rules are loaded in total, including the Kubernetes defaults.

| Dashboard | Panels | Queries checked |
|---|---|---|
| SplitX · Logs | 7 | 6 |
| SplitX · Service | 28 | 39 |

Logs: Alloy reads the application and ingress-nginx logs through the Kubernetes API and ships
them to Loki, parsing the JSON both write. One request made during this run:

| | |
|---|---|
| X-Request-Id | `b18a0cb0b757d2564b04a8eff57f1b8b` |
| ingress-nginx access log | status 200, 0.044 s, sent to `10.244.1.16:3000` |
| Application log | `splitx-7ccd6f8b66-4bgwm` at `10.244.1.16` |

