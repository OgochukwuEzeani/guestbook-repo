# Kubernetes Guestbook with Prometheus & Grafana Monitoring

This project extends the [Pulumi Kubernetes Guestbook example](https://github.com/pulumi/examples/tree/master/kubernetes-ts-guestbook/simple) by adding Prometheus and Grafana monitoring, deployed with Pulumi (TypeScript).

---

## What was added

The original guestbook example provides:
- Redis leader
- Redis replica  
- Frontend (3 pods)

This project adds:
- Prometheus — collects metrics from the cluster
- Grafana — displays metrics in a dashboard
- Scrape annotations on the frontend pods so Prometheus can discover them

---

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Node.js](https://nodejs.org/) >= 18
- A running Kubernetes cluster with kubectl configured
- [Minikube](https://minikube.sigs.k8s.io/) for local development

---

## Deploy

### 1. Install dependencies

```bash
npm install
```

### 2. Login to Pulumi

```bash
pulumi login --local
```

### 3. Create a stack

```bash
pulumi stack init dev
```

### 4. Set the Grafana admin password

```bash
pulumi config set --secret grafanaAdminPassword sretask
```

### 5. Start Minikube

```bash
minikube start
```

### 6. Deploy

```bash
pulumi up
```

### 7. Start Minikube tunnel on a separate terminal
# Minikube does not have a built-in load balancer. This command assigns an external IP to the Grafana service so it can be accessed from a browser.

```bash
minikube tunnel
```

---

## Grafana Access

| | |
|---|---|
| URL | `http://127.0.0.1` |
| Username | `admin` |
| Password | `sretask` |

To also reveal the password via Pulumi:

```bash
pulumi stack output grafanaAdminPassword --show-secrets
```

The **Guestbook Dashboard** is automatically loaded. It shows:
- Frontend pod CPU usage
- Frontend pod memory usage
- Network bytes received
- Running pod count
- Pod restart count

---

## Verify Prometheus is scraping guestbook metrics

### 1. Port-forward to Prometheus

```bash
kubectl port-forward svc/prometheus 9090:9090 -n monitoring
```

### 2. Open the Targets page

Open `http://localhost:9090/targets` in your browser.

Look for the `kubernetes-pods` job — the frontend pods should appear there.

Look for the `kubernetes-cadvisor` job — this should show UP and is what feeds the Grafana dashboard with CPU and memory data.

### 3. Run a test query in Prometheus

Go to `http://localhost:9090/graph` and run:

```
container_cpu_usage_seconds_total{namespace="default",pod=~"frontend.*"}
```

You should see data points for each frontend pod.

---

## Project structure

```
.
├── index.ts              # Guestbook app + scrape annotations
├── monitoring/
│   ├── prometheus.ts     # Prometheus deployment and config
│   ├── grafana.ts        # Grafana deployment and dashboard
│   └── index.ts          # Pulumi outputs
├── Pulumi.yaml
├── Pulumi.dev.yaml
├── package.json
└── tsconfig.json
```

---

## Tear down

```bash
pulumi destroy
```
```



