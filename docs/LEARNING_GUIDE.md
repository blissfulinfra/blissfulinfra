# Learning Guide: Enterprise Infrastructure 101

New to enterprise infrastructure? This guide explains what each component does, how they work together, and provides a hands-on learning path.

---

## Table of Contents

1. [The Components](#the-components)
2. [How They Integrate](#how-they-integrate)
3. [Key Concepts Explained](#key-concepts-explained)
4. [Hands-On Learning Path](#hands-on-learning-path)
5. [Common Scenarios](#common-scenarios)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Resources](#resources)

---

## The Components

| Component | What It Does | Why It Matters |
|-----------|--------------|----------------|
| **CI/CD Pipeline** | Automates build → test → deploy | No manual deployments, consistent process every time |
| **Container Registry** | Stores versioned Docker images | Every deployment is traceable to an exact image |
| **Kubernetes** | Orchestrates containers across machines | Self-healing, scaling, resource management |
| **GitOps (Argo CD)** | Syncs Git state to cluster state | Rollback = git revert, full audit trail |
| **Observability** | Metrics, logs, traces in one place | Know what's happening before users report issues |
| **Canary Deployments** | Gradual rollout with automated checks | Catch problems before 100% of users are affected |
| **Chaos Testing** | Intentionally break things | Know how your service fails before production does |

---

## How They Integrate

### The Full Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEVELOPER WORKFLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. CODE                                                                   │
│   ─────                                                                     │
│   Developer writes code, commits to Git                                     │
│                     │                                                       │
│                     ▼                                                       │
│   2. CI/CD PIPELINE (Jenkins)                                               │
│   ───────────────────────────                                               │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│   │  Build  │─►│  Test   │─►│  Scan   │─►│  Image  │─►│  Push   │          │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│                                                              │              │
│                                                              ▼              │
│   3. CONTAINER REGISTRY (localhost:5050)                                    │
│   ──────────────────────────────────────                                    │
│   Stores versioned images: my-app:abc123, my-app:def456                     │
│                     │                                                       │
│                     ▼                                                       │
│   4. GITOPS (Argo CD)                                                       │
│   ───────────────────                                                       │
│   Watches Git repo, syncs K8s manifests to cluster                          │
│   Detects: "k8s/deployment.yaml says image:abc123, cluster has def456"      │
│   Action: Updates cluster to match Git                                      │
│                     │                                                       │
│                     ▼                                                       │
│   5. KUBERNETES                                                             │
│   ─────────────                                                             │
│   ┌──────────────────────────────────────────────────────────┐             │
│   │  Namespace: my-app-staging                                │             │
│   │  ┌─────────────────┐  ┌─────────────────┐                │             │
│   │  │ Pod: my-app-1   │  │ Pod: my-app-2   │  (replicas)    │             │
│   │  │ CPU: 100m-500m  │  │ CPU: 100m-500m  │                │             │
│   │  │ Mem: 256Mi-512Mi│  │ Mem: 256Mi-512Mi│                │             │
│   │  └─────────────────┘  └─────────────────┘                │             │
│   │           │                    │                          │             │
│   │           └────────┬───────────┘                          │             │
│   │                    ▼                                      │             │
│   │  Service: my-app (load balances across pods)              │             │
│   └──────────────────────────────────────────────────────────┘             │
│                     │                                                       │
│                     ▼                                                       │
│   6. OBSERVABILITY                                                          │
│   ────────────────                                                          │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                        │
│   │   Metrics   │  │    Logs     │  │   Traces    │                        │
│   │ (Prometheus)│  │  (stdout)   │  │  (Jaeger)   │                        │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                        │
│          └────────────────┼────────────────┘                                │
│                           ▼                                                 │
│                    ┌─────────────┐                                          │
│                    │  Dashboard  │                                          │
│                    │  (observe)  │                                          │
│                    └─────────────┘                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration Points

| From | To | How | What Happens |
|------|-----|-----|--------------|
| Git | Jenkins | Webhook / Poll | Code push triggers pipeline |
| Jenkins | Registry | Docker push | Built images stored with tags |
| Registry | Argo CD | Image tag in manifest | Argo sees new tag, syncs |
| Argo CD | Kubernetes | kubectl apply | Pods updated with new image |
| Kubernetes | Prometheus | Scrape endpoint | Metrics collected every 15s |
| Prometheus | Dashboard | PromQL queries | Visualize request rates, errors |
| Kubernetes | Logs | stdout/stderr | Container logs captured |
| All | AI Agent | Log + metric analysis | Root cause identification |

---

## Key Concepts Explained

### CI/CD (Continuous Integration / Continuous Deployment)

**What it is:**
- *Continuous Integration*: Every code change triggers automated builds and tests
- *Continuous Deployment*: Passing code automatically deploys to environments

**Why it matters:**
- Catch bugs early (before they reach production)
- Deploy frequently (small changes = less risk)
- Consistent process (no "works on my machine")

**In blissful-infra:**
```bash
# Your Jenkinsfile defines the pipeline
cat my-app/backend/Jenkinsfile

# Stages: Build → Test → Security Scan → Push Image → Deploy
```

**Key files:**
- `backend/Jenkinsfile` - Pipeline definition
- `backend/Dockerfile` - How to build the container

---

### GitOps

**What it is:**
- Git is the single source of truth for infrastructure
- Change infrastructure by changing YAML files in Git
- Argo CD watches Git and syncs changes to Kubernetes

**Why it matters:**
- Rollback = `git revert` (just undo the commit)
- Full audit trail (who changed what, when)
- Pull requests for infrastructure changes

**In blissful-infra:**
```bash
# Change the replica count
vim my-app/k8s/base/deployment.yaml
# replicas: 2 → replicas: 3

git commit -m "Scale to 3 replicas"
git push

# Argo CD detects the change and updates the cluster
blissful-infra status
# Shows: staging - 3/3 replicas running
```

**Key files:**
- `k8s/base/*.yaml` - Kubernetes manifests
- `k8s/overlays/*/kustomization.yaml` - Environment overrides
- `k8s/argocd/application.yaml` - Argo CD config

---

### Kubernetes (K8s)

**What it is:**
- Container orchestration platform
- You declare the desired state, K8s makes it happen
- Self-healing: if a container dies, K8s restarts it

**Core concepts:**

| Resource | Purpose | Example |
|----------|---------|---------|
| **Pod** | Smallest deployable unit, runs containers | Your app process |
| **Deployment** | Manages Pod replicas, handles updates | "Run 3 copies of my app" |
| **Service** | Stable network endpoint for Pods | Load balancer for your Pods |
| **ConfigMap** | Configuration data (non-secret) | Database URL, feature flags |
| **Secret** | Sensitive configuration | API keys, passwords |
| **Namespace** | Isolation boundary | my-app-staging, my-app-prod |

**In blissful-infra:**
```yaml
# k8s/base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 2                    # Run 2 copies
  template:
    spec:
      containers:
        - name: app
          image: localhost:5050/my-app:latest
          resources:
            requests:
              memory: "256Mi"    # Minimum memory
              cpu: "100m"        # Minimum CPU (0.1 core)
            limits:
              memory: "512Mi"    # Maximum memory
              cpu: "500m"        # Maximum CPU (0.5 core)
```

---

### Observability (The Three Pillars)

**Metrics** - Numbers over time
- CPU usage, memory, request count, error rate
- Aggregated data, good for alerting
- Example: "Error rate > 1% for 5 minutes"

**Logs** - Text output from your application
- Detailed context for debugging
- Example: "Error processing order #123: null pointer"

**Traces** - Follow a request across services
- See how long each service took
- Find which service caused the slowdown

**In blissful-infra:**
```bash
# View metrics in dashboard
blissful-infra dashboard
# Open http://localhost:3001

# View logs
blissful-infra my-app logs

# Ask the agent
blissful-infra my-app agent --query "Why is latency high?"
```

---

### Canary Deployments

**What it is:**
- Deploy new version to small % of traffic (10%)
- Monitor metrics (error rate, latency)
- If good, increase traffic (25% → 50% → 100%)
- If bad, automatic rollback

**Why it matters:**
- Catch bugs before 100% of users see them
- Automatic rollback = faster recovery
- Data-driven deployment decisions

**In blissful-infra:**
```bash
# Deploy with canary strategy
blissful-infra deploy --canary --env production

# Watch the rollout
blissful-infra canary status

# Output:
# Step 1: 10% ✓ Passed
# Step 2: 25% ✓ Passed
# Step 3: 50% ⏳ In Progress
# Step 4: 100% Pending
```

---

### Chaos Testing

**What it is:**
- Intentionally inject failures
- Verify the system handles them gracefully
- Build confidence before real failures happen

**Common scenarios:**

| Failure | What Happens | Expected Behavior |
|---------|--------------|-------------------|
| Pod killed | Container crashes | K8s restarts it |
| Network delay | 500ms latency added | Timeouts, retries work |
| CPU stress | CPU maxed out | Throttling, no OOMKill |
| Dependency down | Database unreachable | Circuit breaker opens |

**In blissful-infra:**
```bash
# Run chaos scenarios
blissful-infra chaos --env staging

# Test specific failure
blissful-infra chaos --scenario pod-kill

# Get resilience score
# Output: Resilience Score: 78/100
```

---

## Hands-On Learning Path

### Level 1: Explore (30 minutes)

```bash
# 1. Create a project
blissful-infra start my-app

# 2. Explore the generated files
ls -la my-app/
cat my-app/backend/Jenkinsfile
cat my-app/k8s/base/deployment.yaml

# 3. Start the project
blissful-infra my-app up

# 4. View it running
open http://localhost:8080
```

### Level 2: Understand CI/CD (30 minutes)

```bash
# 1. Read the Jenkinsfile
cat my-app/backend/Jenkinsfile

# 2. Run the pipeline locally
blissful-infra my-app pipeline --local

# 3. Watch each stage execute
# Build → Test → Containerize → Push

# 4. Check the registry
curl http://localhost:5050/v2/_catalog
```

### Level 3: Work with Kubernetes (1 hour)

```bash
# 1. Read the manifests
cat my-app/k8s/base/deployment.yaml
cat my-app/k8s/base/service.yaml

# 2. Understand the overlay system
cat my-app/k8s/overlays/staging/kustomization.yaml

# 3. Deploy to local Kind cluster
blissful-infra my-app deploy --env staging

# 4. Check status
blissful-infra my-app status
```

### Level 4: Debug with Observability (1 hour)

```bash
# 1. Start the dashboard
blissful-infra dashboard

# 2. Generate some traffic
curl http://localhost:8080/api/hello

# 3. View metrics in dashboard
# Open http://localhost:3001

# 4. Introduce a bug
# Edit code to add a delay or error

# 5. Ask the agent
blissful-infra my-app agent --query "Why is latency high?"
```

### Level 5: Test Resilience (1 hour)

```bash
# 1. Run chaos testing
blissful-infra my-app chaos

# 2. View the resilience report
# See which failures the system handles

# 3. Test canary rollback
blissful-infra canary test --simulate-failure error-rate --value 5%

# 4. Watch automatic rollback
blissful-infra canary status
```

---

## Common Scenarios

### "I pushed code, how do I deploy it?"

```bash
# Option 1: Local pipeline
blissful-infra my-app pipeline --local --push
blissful-infra my-app deploy --env staging

# Option 2: Via Jenkins
blissful-infra jenkins build my-app
```

### "Something is broken, how do I debug?"

```bash
# 1. Check logs
blissful-infra my-app logs --follow

# 2. Ask the agent
blissful-infra my-app agent --query "What errors are in the logs?"

# 3. View metrics in dashboard
blissful-infra dashboard
```

### "I need to rollback"

```bash
# Option 1: Rollback deployment
blissful-infra my-app rollback --env staging

# Option 2: Git revert (GitOps)
git revert HEAD
git push
# Argo CD will sync the previous version
```

### "How do I scale up?"

```bash
# Edit k8s/base/deployment.yaml
# Change replicas: 2 → replicas: 4

git commit -m "Scale to 4 replicas"
git push

# Or directly (not GitOps)
kubectl scale deployment my-app -n my-app-staging --replicas=4
```

---

## Troubleshooting Guide

### Pipeline fails at "Build"

```bash
# Check Docker is running
docker info

# Check the Dockerfile syntax
docker build -t test .
```

### Pods are "CrashLoopBackOff"

```bash
# Check pod logs
kubectl logs -n my-app-staging deployment/my-app

# Check events
kubectl describe pod -n my-app-staging -l app=my-app

# Common causes:
# - App crashes on startup
# - Missing environment variables
# - Can't connect to database
```

### OOMKilled errors

```bash
# Check memory limits in deployment.yaml
# Increase limits.memory

# Common causes:
# - Memory leak in app
# - Limits too low for workload
```

### "Connection refused" errors

```bash
# Check if service exists
kubectl get svc -n my-app-staging

# Check if pods are running
kubectl get pods -n my-app-staging

# Check pod is listening on correct port
kubectl exec -n my-app-staging deployment/my-app -- netstat -tlnp
```

---

## Resources

### Official Documentation
- [Kubernetes Concepts](https://kubernetes.io/docs/concepts/) - Core K8s concepts
- [Argo CD User Guide](https://argo-cd.readthedocs.io/) - GitOps with Argo
- [Jenkins Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) - Jenkinsfile reference

### Best Practices
- [The Twelve-Factor App](https://12factor.net/) - Cloud-native app principles
- [SRE Book](https://sre.google/sre-book/table-of-contents/) - Google's reliability guide
- [Kubernetes Patterns](https://k8spatterns.io/) - Common K8s design patterns

### Tutorials
- [Kubernetes the Hard Way](https://github.com/kelseyhightower/kubernetes-the-hard-way) - Deep K8s understanding
- [GitOps with Argo CD](https://codefresh.io/learn/argo-cd/) - GitOps tutorial
- [Prometheus Basics](https://prometheus.io/docs/introduction/overview/) - Monitoring fundamentals

---

## Next Steps

1. **Explore the codebase** - Look at generated files, understand the structure
2. **Break things intentionally** - Run chaos tests, see how the system recovers
3. **Build something real** - Use blissful-infra for a side project
4. **Contribute** - Found something confusing? Improve the docs!

---

<div align="center">

**Questions?** Ask the AI agent: `blissful-infra my-app agent`

</div>
