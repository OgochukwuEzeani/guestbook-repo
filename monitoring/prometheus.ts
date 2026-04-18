import * as k8s from "@pulumi/kubernetes";

export const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", {
    metadata: { name: "monitoring" },
});


// Give Prometheus permission to discover and read pods, services and nodes
const serviceAccount = new k8s.core.v1.ServiceAccount("prometheus", {
    metadata: { name: "prometheus", namespace: "monitoring" },
}, { dependsOn: monitoringNamespace });

const clusterRole = new k8s.rbac.v1.ClusterRole("prometheus", {
    metadata: { name: "prometheus" },
    rules: [
        {
            apiGroups: [""],
            resources: ["nodes", "nodes/proxy", "services", "endpoints", "pods"],
            verbs: ["get", "list", "watch"],
        },
        {
            nonResourceURLs: ["/metrics", "/metrics/cadvisor"],
            verbs: ["get"],
        },
    ],
});

// Bind the role to the service account so Prometheus can use these permissions
const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("prometheus", {
    metadata: { name: "prometheus" },
    roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "prometheus",
    },
    subjects: [{ kind: "ServiceAccount", name: "prometheus", namespace: "monitoring" }],
}, { dependsOn: [clusterRole, serviceAccount] });


// Configuration file telling Prometheus what to scrape and how often
const prometheusConfig = new k8s.core.v1.ConfigMap("prometheus-config", {
    metadata: { name: "prometheus-config", namespace: "monitoring" },
    data: {
        "prometheus.yml": `
global:
  scrape_interval: 15s

scrape_configs:

  # Scrape Prometheus itself
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # cAdvisor gives us CPU, memory and network metrics per container
  - job_name: 'kubernetes-cadvisor'
    scheme: https
    metrics_path: /metrics/cadvisor
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      insecure_skip_verify: true
    bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - target_label: __address__
        replacement: kubernetes.default.svc:443
      - source_labels: [__meta_kubernetes_node_name]
        regex: (.+)
        target_label: __metrics_path__
        replacement: /api/v1/nodes/$1/proxy/metrics/cadvisor

  # Scrape any pod that has the prometheus.io/scrape: "true" annotation
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\\d+)?;(\\d+)
        replacement: $1:$2
        target_label: __address__
      - action: labelmap
        regex: __meta_kubernetes_pod_label_(.+)
      - source_labels: [__meta_kubernetes_namespace]
        target_label: kubernetes_namespace
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: kubernetes_pod_name
`,
    },
}, { dependsOn: monitoringNamespace });



// Run Prometheus as a pod inside the monitoring namespace
export const prometheusDeployment = new k8s.apps.v1.Deployment("prometheus", {
    metadata: { name: "prometheus", namespace: "monitoring" },
    spec: {
        replicas: 1,
        selector: { matchLabels: { app: "prometheus" } },
        template: {
            metadata: { labels: { app: "prometheus" } },
            spec: {
                serviceAccountName: "prometheus",
                containers: [{
                    name: "prometheus",
                    image: "prom/prometheus:v2.48.0",
                    args: [
                        "--config.file=/etc/prometheus/prometheus.yml",
                        "--storage.tsdb.path=/prometheus",
                        "--storage.tsdb.retention.time=7d",
                        "--web.enable-lifecycle",
                    ],
                    ports: [{ containerPort: 9090 }],
                    resources: {
                        requests: { cpu: "200m", memory: "256Mi" },
                        limits: { cpu: "500m", memory: "512Mi" },
                    },
                    volumeMounts: [
                        { name: "config", mountPath: "/etc/prometheus" },
                        { name: "storage", mountPath: "/prometheus" },
                    ],
                }],
                volumes: [
                    { name: "config", configMap: { name: "prometheus-config" } },
                    { name: "storage", emptyDir: {} },
                ],
            },
        },
    },
}, { dependsOn: [prometheusConfig, clusterRoleBinding] });


// Expose Prometheus internally so Grafana can connect to it
export const prometheusService = new k8s.core.v1.Service("prometheus", {
    metadata: { name: "prometheus", namespace: "monitoring" },
    spec: {
        selector: { app: "prometheus" },
        type: "ClusterIP",
        ports: [{ port: 9090, targetPort: 9090 }],
    },
}, { dependsOn: prometheusDeployment });
