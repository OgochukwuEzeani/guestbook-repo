import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { monitoringNamespace } from "./prometheus";

const config = new pulumi.Config();
export const grafanaAdminPassword = config.getSecret("grafanaAdminPassword") ?? pulumi.secret("admin123");


// Tell Grafana where to find Prometheus
const datasourceConfig = new k8s.core.v1.ConfigMap("grafana-datasources", {
    metadata: { name: "grafana-datasources", namespace: "monitoring" },
    data: {
        "datasources.yaml": `
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    url: http://prometheus.monitoring.svc.cluster.local:9090
    access: proxy
    isDefault: true
`,
    },
}, { dependsOn: monitoringNamespace });


// Tell Grafana where to find the dashboard files
const dashboardProviderConfig = new k8s.core.v1.ConfigMap("grafana-dashboard-provider", {
    metadata: { name: "grafana-dashboard-provider", namespace: "monitoring" },
    data: {
        "provider.yaml": `
apiVersion: 1
providers:
  - name: guestbook
    type: file
    options:
      path: /var/lib/grafana/dashboards
`,
    },
}, { dependsOn: monitoringNamespace });


// The actual dashboard that displays guestbook metrics
const dashboardJson = JSON.stringify({
    title: "Guestbook Dashboard",
    uid: "guestbook",
    schemaVersion: 38,
    refresh: "30s",
    time: { from: "now-1h", to: "now" },
    panels: [
        {
            id: 1, title: "Frontend Pod CPU Usage", type: "timeseries",
            gridPos: { x: 0, y: 0, w: 12, h: 8 },
            datasource: { type: "prometheus", uid: "prometheus" },
            targets: [{
                expr: `rate(container_cpu_usage_seconds_total{namespace="default",pod=~"frontend.*"}[5m]) * 100`,
                legendFormat: "{{pod}}", refId: "A",
            }],
            fieldConfig: { defaults: { unit: "percent" } },
        },
        {
            id: 2, title: "Frontend Pod Memory", type: "timeseries",
            gridPos: { x: 12, y: 0, w: 12, h: 8 },
            datasource: { type: "prometheus", uid: "prometheus" },
            targets: [{
                expr: `container_memory_working_set_bytes{namespace="default",pod=~"frontend.*"}`,
                legendFormat: "{{pod}}", refId: "A",
            }],
            fieldConfig: { defaults: { unit: "bytes" } },
        },
        {
            id: 3, title: "Network Bytes Received", type: "timeseries",
            gridPos: { x: 0, y: 8, w: 12, h: 8 },
            datasource: { type: "prometheus", uid: "prometheus" },
            targets: [{
                expr: `rate(container_network_receive_bytes_total{namespace="default",pod=~"frontend.*"}[5m])`,
                legendFormat: "{{pod}}", refId: "A",
            }],
            fieldConfig: { defaults: { unit: "Bps" } },
        },
        {
            id: 4, title: "Running Pods", type: "stat",
            gridPos: { x: 12, y: 8, w: 6, h: 8 },
            datasource: { type: "prometheus", uid: "prometheus" },
            targets: [{
                expr: `count(kube_pod_status_phase{namespace="default",phase="Running"})`,
                legendFormat: "Running", refId: "A",
            }],
        },
        {
            id: 5, title: "Pod Restarts", type: "stat",
            gridPos: { x: 18, y: 8, w: 6, h: 8 },
            datasource: { type: "prometheus", uid: "prometheus" },
            targets: [{
                expr: `sum(kube_pod_container_status_restarts_total{namespace="default"})`,
                legendFormat: "Restarts", refId: "A",
            }],
            fieldConfig: {
                defaults: {
                    thresholds: {
                        mode: "absolute",
                        steps: [{ color: "green", value: 0 }, { color: "red", value: 5 }],
                    },
                },
            },
        },
    ],
});

const dashboardConfig = new k8s.core.v1.ConfigMap("grafana-dashboards", {
    metadata: { name: "grafana-dashboards", namespace: "monitoring" },
    data: { "guestbook.json": dashboardJson },
}, { dependsOn: monitoringNamespace });



// Store admin credentials as a Kubernetes secret
const grafanaSecret = new k8s.core.v1.Secret("grafana-secret", {
    metadata: { name: "grafana-secret", namespace: "monitoring" },
    stringData: {
        "admin-user": "admin",
        "admin-password": grafanaAdminPassword as unknown as string,
    },
}, { dependsOn: monitoringNamespace });




// Run Grafana as a pod inside the monitoring namespace
export const grafanaDeployment = new k8s.apps.v1.Deployment("grafana", {
    metadata: { name: "grafana", namespace: "monitoring" },
    spec: {
        replicas: 1,
        selector: { matchLabels: { app: "grafana" } },
        template: {
            metadata: { labels: { app: "grafana" } },
            spec: {
                securityContext: { fsGroup: 472, runAsUser: 472 },
                containers: [{
                    name: "grafana",
                    image: "grafana/grafana:10.2.0",
                    ports: [{ containerPort: 3000 }],
                    env: [
                        {
                            name: "GF_SECURITY_ADMIN_USER",
                            valueFrom: { secretKeyRef: { name: "grafana-secret", key: "admin-user" } },
                        },
                        {
                            name: "GF_SECURITY_ADMIN_PASSWORD",
                            valueFrom: { secretKeyRef: { name: "grafana-secret", key: "admin-password" } },
                        },
                        { name: "GF_USERS_ALLOW_SIGN_UP", value: "false" },
                    ],
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "300m", memory: "256Mi" },
                    },
                    volumeMounts: [
                        { name: "datasources", mountPath: "/etc/grafana/provisioning/datasources" },
                        { name: "dashboard-provider", mountPath: "/etc/grafana/provisioning/dashboards" },
                        { name: "dashboards", mountPath: "/var/lib/grafana/dashboards" },
                        { name: "storage", mountPath: "/var/lib/grafana" },
                    ],
                    readinessProbe: {
                        httpGet: { path: "/api/health", port: 3000 },
                        initialDelaySeconds: 30,
                        periodSeconds: 10,
                    },
                }],
                volumes: [
                    { name: "datasources", configMap: { name: "grafana-datasources" } },
                    { name: "dashboard-provider", configMap: { name: "grafana-dashboard-provider" } },
                    { name: "dashboards", configMap: { name: "grafana-dashboards" } },
                    { name: "storage", emptyDir: {} },
                ],
            },
        },
    },
}, { dependsOn: [datasourceConfig, dashboardProviderConfig, dashboardConfig, grafanaSecret] });


// Expose Grafana externally so we can access it from a browser
export const grafanaService = new k8s.core.v1.Service("grafana", {
    metadata: { name: "grafana", namespace: "monitoring" },
    spec: {
        type: "LoadBalancer",
        selector: { app: "grafana" },
        ports: [{ port: 80, targetPort: 3000 }],
    },
}, { dependsOn: grafanaDeployment });
