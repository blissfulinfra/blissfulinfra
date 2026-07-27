resource "helm_release" "argo_rollouts" {
  name             = "argo-rollouts"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-rollouts"
  version          = "2.39.0"
  namespace        = "argo-rollouts"
  create_namespace = true
  timeout          = 300

  values = [file("${path.module}/rollouts-values.yaml")]

  depends_on = [kind_cluster.this]
}
