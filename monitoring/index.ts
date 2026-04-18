import * as pulumi from "@pulumi/pulumi";
export { grafanaAdminPassword } from "./grafana";
import { grafanaService } from "./grafana";

// Print the Grafana URL after deployment
export const grafanaUrl = grafanaService.status.apply(status => {
    const ingress = status?.loadBalancer?.ingress?.[0];
    if (!ingress) return "Pending — run: kubectl get svc grafana -n monitoring";
    const host = ingress.hostname ?? ingress.ip ?? "pending";
    return `http://${host}`;
});

export const grafanaAdminUser = "admin";

// How to verify Prometheus is scraping the guestbook pods
export const verifyMetricsCommand =
    "kubectl port-forward svc/prometheus 9090:9090 -n monitoring\n" +
    "Then open: http://localhost:9090/targets\n" +
    "Look for job 'kubernetes-pods' — guestbook frontend pods should show status UP";
