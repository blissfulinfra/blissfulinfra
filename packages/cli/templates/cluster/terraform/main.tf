# Tenant-level local Kubernetes cluster (ADR-0020).
# One kind cluster per tenant; projects map to namespaces, services deploy as
# Argo Rollouts synced by ArgoCD from the tenant's in-cluster Gitea repo.
#
# Rendered by `blissful-infra cluster up` — placeholders are substituted
# from the tenant's registry port block before terraform runs.

provider "kind" {}

resource "kind_cluster" "this" {
  name           = "blissful-{{TENANT_NAME}}"
  node_image     = "kindest/node:v1.31.4"
  wait_for_ready = true

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    networking {
      api_server_address = "127.0.0.1"
      api_server_port    = {{KUBE_API_PORT}}
    }

    node {
      role = "control-plane"

      # NodePort 30080 → host {{ARGOCD_PORT}} (ArgoCD UI)
      extra_port_mappings {
        container_port = 30080
        host_port      = {{ARGOCD_PORT}}
      }

      # NodePort 30300 → host {{GITEA_PORT}} (Gitea HTTP: UI + git push)
      extra_port_mappings {
        container_port = 30300
        host_port      = {{GITEA_PORT}}
      }
    }
  }
}

provider "helm" {
  kubernetes {
    host                   = kind_cluster.this.endpoint
    client_certificate     = kind_cluster.this.client_certificate
    client_key             = kind_cluster.this.client_key
    cluster_ca_certificate = kind_cluster.this.cluster_ca_certificate
  }
}

output "cluster_name" {
  value = kind_cluster.this.name
}

output "kubeconfig" {
  value     = kind_cluster.this.kubeconfig
  sensitive = true
}
