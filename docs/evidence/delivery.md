# Delivery — what happens between a merge and a running pod

Written by `scripts/delivery-verify.mjs` (`npm run cd:verify`) on 2026-09-20.
Every line is an answer from the running Jenkins, the running relay, the API server or GitHub.

## Result

| Check | Result | Detail |
|---|---|---|
| Jenkins answers the admin from .env, and nobody else | pass | admin authenticated: true; without credentials: HTTP 403 |
| The deploy job is defined by code, with the webhook trigger | pass | splitx-deploy: 5 parameters, a GenericTrigger, and jenkins/Jenkinsfile from the repository |
| Every plugin is the pinned version, and all of them loaded | pass | 81 plugins, all pinned in helm/platform/jenkins.values.yaml and all active |
| The credentials come from Kubernetes Secrets, by name only | pass | github-webhook-secret, webhook-trigger-token, github-deployments-token — the values live in the Secrets k8s:up builds from .env |
| A delivery GitHub did not sign is refused | pass | no signature at all: HTTP 403; signed with another secret: HTTP 403; changed after GitHub signed it: HTTP 403 |
| A correctly signed delivery with the wrong token reaches no job | pass | HTTP 404 |
| Signed events that are not a deployment for this cluster start nothing | pass | a ping and a deployment for "aws" were accepted (HTTP 200) and started no build; the job still has 4 build(s) |
| The relay is holding the smee.io channel open | pass | webhook_relay_connected = 1, pod ready |
| A delivery posted to the channel arrives at Jenkins, signature intact | pass | a signed ping went out to smee.io and Jenkins accepted it (the relay rebuilt the body and the signature still verified) |
| A deploy build may change the application, and nothing else | pass | 3 allowed, 5 refused, as declared in jenkins/rbac.yaml |
| The cluster runs the image GitHub Actions signed for the newest deployment | pass | deployment 6549770679 of 52137218e1d4: 2 pod(s) running sha256:b76908997f69… |
| Jenkins verified that signature before it deployed | pass | build #2: signed by https://github.com/Sayandip-Jana-1018/SplitX/.github/workflows/ci.yml@refs/heads/main at commit 52137218e1d4; cosign checked: |
| A release that never becomes ready is rolled back, and the site keeps serving | pass | build #5 FAILURE after 210 s; rolled back to what ran before; 717 of 717 requests answered 200 while it happened |

## The chain

```
merge to main
  -> GitHub Actions: test, build once, scan (Trivy), sign (cosign, keyless), publish to ghcr.io
  -> GitHub deployment for the environment "kind", naming the image by digest
  -> webhook, signed by GitHub
  -> smee.io channel -> relay in the cluster -> Jenkins (signature checked here)
  -> Jenkins: newest? signed by main's workflow, same commit? then apply that commit's manifests
  -> rollout, checked through the ingress; anything unhealthy is rolled back
  -> the outcome is reported back on the GitHub deployment
```

## Jenkins

Jenkins runs in the cluster as the pinned chart in `helm/platform/charts.json`, in a namespace at the
same `restricted` Pod Security level as the application. It builds nothing, so no build needs root or
a Docker socket: GitHub Actions builds and signs, Jenkins deploys.

| | |
|---|---|
| Configuration | `helm/platform/jenkins.values.yaml`: security realm, credentials, the webhook gate and the job itself (Job DSL) |
| Plugins | 81, each pinned with its dependencies |
| Job | `splitx-deploy`, its steps in `jenkins/Jenkinsfile` on main |
| Builds run | in an agent pod as `jenkins-deployer`, with the official kubectl and cosign images mounted read-only |

## What Jenkins accepts

The job is started by GitHub's `deployment` webhook and nothing else. The Generic Webhook Trigger
verifies GitHub's `X-Hub-Signature-256` against the secret in `.env` before any job sees the delivery,
so the relay that carries it (D-056) is only a courier: it cannot forge or change one.

| Delivery | Answer |
|---|---|
| Not signed | HTTP 403, no build |
| Signed with another secret | HTTP 403, no build |
| Changed after signing | HTTP 403, no build |
| Signed, wrong endpoint token | HTTP 404, no build |
| Signed `ping` | HTTP 200, no build (it is not a deployment) |
| Signed deployment for `aws` | HTTP 200, no build (this Jenkins deploys `kind`) |

## The relay

GitHub cannot reach a Jenkins on a laptop, so the repository's webhook posts to a smee.io channel and
`jenkins/relay/relay.mjs`, inside the cluster, replays each delivery to Jenkins with GitHub's own headers.
It never holds the webhook secret, so a delivery it invented would be refused like any other (above).
On AWS, GitHub calls Jenkins directly and the relay is not deployed.

| | |
|---|---|
| Stream | connected |
| Deliveries accepted by Jenkins | 3 |
| Refused by Jenkins | 0 |
| Jenkins unreachable | 0 |

smee.io keeps nothing for a listener that is away, so `WebhookRelayDisconnected` fires after five minutes
without the stream, and `WebhookDeliveryRefused` on anything Jenkins did not accept
(`jenkins/prometheusrule.yaml`, unit-tested in `npm run test:alerts`).

## The deploy account

Deploy builds run as `jenkins/jenkins-deployer`, which the chart creates without permissions. The Role in
`jenkins/rbac.yaml` gives it exactly what applying the release needs, in the `splitx` namespace only.
The API server was asked about each of these:

| May it… | |
|---|---|
| patch deployments in splitx | yes |
| delete the schema job in splitx | yes |
| read pods in splitx | yes |
| read secrets in splitx | no |
| exec into a pod in splitx | no |
| change anything in monitoring | no |
| change anything in kube-system | no |
| read nodes | no |

Creating a workload always implies reading the Secrets that workload mounts, which is what deploying the
application means; it cannot read them through the API, exec into a pod, or touch another namespace.

## The release running now

A release is one commit on main that passed CI: built once, published as
`ghcr.io/sayandip-jana-1018/splitx:<commit>`, scanned, signed with cosign, and announced as a GitHub
deployment whose payload names the image by digest (D-054). Jenkins deploys that digest, after checking
the signature names this repository's CI workflow, on main, at the same commit.

| | |
|---|---|
| GitHub deployment | `6549770679` for `52137218e1d4`, environment `kind` |
| Image | `sha256:b76908997f6972980f9546fddbc15385fff8f7c98fb6e2e96522f40ee540c5e3` |
| Running | 2 ready pod(s): `splitx-77d484dcf8-8vmtb`, `splitx-77d484dcf8-mzb69` |
| Deployed by | Jenkins build #2 |

The deployed manifests are the release commit's own (`kubectl apply -k` of the overlay at that commit),
with only the image replaced by the verified digest, so the pods get the configuration their code expects.

## A release that cannot come up

Rehearsed on purpose: the same signed release, deployed with an environment variable that makes the
readiness probe fail (`fault=unready`, a parameter the webhook cannot set). The new pods start and
never become ready, which is what a wrong database address or a missing setting looks like.

| | |
|---|---|
| Jenkins build | #5, FAILURE after 210 s |
| What the rollout did | `maxUnavailable: 0`, so the new pod waited for readiness and the old pods kept serving |
| What Jenkins did | waited 150 s for the rollout, then rolled the deployment back to the revision it had recorded before applying |
| Running after | `sha256:b76908997f69…`, the image that ran before |
| What visitors saw | 717 of 717 requests answered 200 during the failed release and its rollback |

The same path runs when a release is genuinely broken: the build fails and the cluster keeps the release
it had. GitHub's own deployment is marked failed too, once `.env` holds a token that may write
deployment statuses.

