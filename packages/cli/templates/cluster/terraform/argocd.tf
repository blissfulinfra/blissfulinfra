resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "7.7.11"
  namespace        = "argocd"
  create_namespace = true
  timeout          = 600

  values = [file("${path.module}/argocd-values.yaml")]

  depends_on = [kind_cluster.this]
}
