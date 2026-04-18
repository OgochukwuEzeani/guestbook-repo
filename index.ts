import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const useLoadBalancer = config.getBoolean("useLoadBalancer");

//
// REDIS LEADER
//

const redisLeaderLabels = { app: "redis-leader" };
const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
    spec: {
        selector: { matchLabels: redisLeaderLabels },
        template: {
            metadata: { labels: redisLeaderLabels },
            spec: {
                containers: [{
                    name: "redis-leader",
                    image: "redis:7.0",
                    resources: { requests: { cpu: "100m", memory: "100Mi" } },
                    ports: [{ containerPort: 6379 }],
                }],
            },
        },
    },
});
const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
    metadata: {
        name: "redis-leader",
        labels: redisLeaderDeployment.metadata.labels,
    },
    spec: {
        ports: [{ port: 6379, targetPort: 6379 }],
        selector: redisLeaderDeployment.spec.template.metadata.labels,
    },
});

//
// REDIS REPLICA
//

const redisReplicaLabels = { app: "redis-replica" };
const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
    spec: {
        selector: { matchLabels: redisReplicaLabels },
        template: {
            metadata: { labels: redisReplicaLabels },
            spec: {
                containers: [{
                    name: "replica",
                    image: "pulumi/guestbook-redis-replica",
                    resources: { requests: { cpu: "100m", memory: "100Mi" } },
                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                    ports: [{ containerPort: 6379 }],
                }],
            },
        },
    },
});
const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        name: "redis-replica",
        labels: redisReplicaDeployment.metadata.labels,
    },
    spec: {
        ports: [{ port: 6379, targetPort: 6379 }],
        selector: redisReplicaDeployment.spec.template.metadata.labels,
    },
});

//
// FRONTEND
//

const frontendLabels = { app: "frontend" };
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    spec: {
        selector: { matchLabels: frontendLabels },
        replicas: 3,
        template: {
            metadata: {
                labels: frontendLabels,
                // Scrape pods for monitoring data
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "80",
                    "prometheus.io/path": "/",
                },
            },
            spec: {
                containers: [{
                    name: "frontend",
                    image: "pulumi/guestbook-php-redis",
                    resources: { requests: { cpu: "100m", memory: "100Mi" } },
                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                    ports: [{ containerPort: 80 }],
                }],
            },
        },
    },
});
const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        name: "frontend",
        labels: frontendDeployment.metadata.labels,
        annotations: {
            "prometheus.io/scrape": "true",
            "prometheus.io/port": "80",
        },
    },
    spec: {
        type: useLoadBalancer ? "LoadBalancer" : "ClusterIP",
        ports: [{ port: 80 }],
        selector: frontendDeployment.spec.template.metadata.labels,
    },
});

// Export the frontend IP
export let frontendIp: pulumi.Output<string>;
if (useLoadBalancer) {
    frontendIp = frontendService.status.loadBalancer.ingress[0].ip;
} else {
    frontendIp = frontendService.spec.clusterIP;
}



// Add monitoring
export * from "./monitoring";

