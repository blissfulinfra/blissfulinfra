resource "helm_release" "gitea" {
  name             = "gitea"
  repository       = "https://dl.gitea.com/charts/"
  chart            = "gitea"
  version          = "10.6.0"
  namespace        = "gitea"
  create_namespace = true
  timeout          = 600

  values = [file("${path.module}/gitea-values.yaml")]

  depends_on = [kind_cluster.this]
}
