# Memory while the Kind cluster runs (B-027)

Written by `scripts/memory-sample.mjs` in a `kind-e2e` run on a GitHub-hosted runner with 15990 MB.
99 samples, one every 10 s, from 2026-09-25T04:34:25.173Z to 2026-09-25T04:51:02.797Z.
"Anonymous" is memory processes asked for; "shared" is tmpfs and shared mappings; "cache" is
files kept in memory, which the kernel gives back under pressure. Each node is its own cgroup.

| Series (MB) | At the start | Peak | Peak during | At the end |
|---|---|---|---|---|
| used | 1028 | 8241 | ops-verify | 8209 |
| cached | 4142 | 11011 | k8s:up | 6857 |
| anon | 349 | 6713 | ops-verify | 6713 |
| splitx-worker2:file | 0 | 3902 | k8s:up | 2721 |
| splitx-worker2:anon | 0 | 3544 | ops-verify | 3538 |
| splitx-worker:file | 0 | 2051 | delivery | 1723 |
| splitx-control-plane:anon | 0 | 1572 | cd:verify | 1508 |
| splitx-control-plane:file | 0 | 1265 | k8s:up | 839 |
| splitx-worker:anon | 0 | 1248 | ops-verify | 1248 |
| shmem | 48 | 118 | ops-verify | 118 |
| splitx-worker:shmem | 0 | 35 | ops-verify | 35 |
| splitx-worker2:shmem | 0 | 20 | ops-verify | 20 |
| splitx-control-plane:shmem | 0 | 11 | k8s:up | 11 |
| swap | 0 | 0 | before the cluster | 0 |

Phases, in order: before the cluster → k8s:up → delivery → k8s:verify → cd:verify → ops-verify.

## The pods holding the most memory at the end

```
NAMESPACE            NAME                                                        CPU(cores)   MEMORY(bytes)   
nexus                nexus-0                                                     33m          1223Mi          
kube-system          kube-apiserver-splitx-control-plane                         90m          1075Mi          
jenkins              jenkins-0                                                   5m           843Mi           
monitoring           kube-prometheus-stack-grafana-646bc59c64-djwwf              13m          459Mi           
monitoring           prometheus-kube-prometheus-stack-prometheus-0               36m          368Mi           
monitoring           loki-0                                                      19m          149Mi           
kube-system          etcd-splitx-control-plane                                   30m          149Mi           
splitx               splitx-77664d4dc9-55dsl                                     92m          105Mi           
splitx               splitx-77664d4dc9-6lcs9                                     98m          105Mi           
kube-system          kube-controller-manager-splitx-control-plane                12m          104Mi           
kyverno              kyverno-admission-controller-8557b79d7-gfwwq                5m           93Mi            
splitx               splitx-77664d4dc9-5bxjx                                     212m         91Mi            
ingress-nginx        ingress-nginx-controller-55f9d44677-mgxpt                   42m          91Mi            
splitx               splitx-77664d4dc9-smzgj                                     143m         91Mi            
splitx               splitx-77664d4dc9-pjnn7                                     201m         90Mi            
splitx               splitx-77664d4dc9-z26fg                                     113m         89Mi            
splitx               splitx-77664d4dc9-wbnmj                                     216m         88Mi            
monitoring           alloy-76f6cc6d87-54sp7                                      36m          86Mi            
splitx               splitx-77664d4dc9-qxns6                                     147m         86Mi            
kyverno              kyverno-admission-controller-8557b79d7-bjbhd                3m           85Mi            
splitx               splitx-77664d4dc9-2tb9j                                     96m          85Mi            
splitx               splitx-77664d4dc9-7z86m                                     227m         84Mi            
kyverno              kyverno-reports-controller-79888b87ff-h9djh                 4m           81Mi            
monitoring           alertmanager-kube-prometheus-stack-alertmanager-0           2m           45Mi            
splitx               splitx-postgres-0                                           7m           44Mi            
ops                  traffic-lab-8f584b769-pgh2h                                 54m          43Mi            
kube-system          kube-scheduler-splitx-control-plane                         8m           40Mi            
monitoring           kube-prometheus-stack-operator-864b8d94d4-jcnhg             4m           39Mi            
monitoring           kube-prometheus-stack-kube-state-metrics-6cb79b9b99-zgmdl   2m           35Mi            
ops                  ops-api-748c8cb657-h9bcd                                    16m          33Mi            
jenkins              webhook-relay-77d89759c4-vvhfg                              1m           30Mi            
kube-system          metrics-server-8488f9c88f-tzdrf                             4m           28Mi            
kube-system          coredns-7d764666f9-2hpfx                                    5m           24Mi            
kube-system          coredns-7d764666f9-qzx6s                                    6m           23Mi            
node-exporter        kube-prometheus-stack-prometheus-node-exporter-rdhpb        3m           20Mi            
kube-system          kube-proxy-tczsx                                            1m           20Mi            
node-exporter        kube-prometheus-stack-prometheus-node-exporter-hjb7f        4m           20Mi            
kube-system          kube-proxy-87srv                                            1m           18Mi            
kube-system          kindnet-hn29c                                               7m           18Mi            
kube-system          kindnet-m696p                                               1m           18Mi            
kube-system          kube-proxy-p5z5s                                            1m           17Mi            
node-exporter        kube-prometheus-stack-prometheus-node-exporter-jt8xz        2m           17Mi            
kube-system          kindnet-lwt2p                                               1m           14Mi            
local-path-storage   local-path-provisioner-67b8995b4b-zhbp6                     1m           14Mi            
splitx               splitx-redis-5d86cfb785-lkn28                               21m          8Mi
```

