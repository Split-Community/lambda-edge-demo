# Lambda@Edge does not support environment variables. Bake config into the package.
# REPLICA_REGIONS: only these regions have the Global Table; edge may run elsewhere → fallback to first.
resource "local_file" "edge_config" {
  content = jsonencode({
    TABLE_NAME        = aws_dynamodb_table.storage.name
    STORAGE_PK        = "DATA"
    SPLIT_SDK_KEY     = var.split_sdk_key
    FEATURE_FLAG_NAME = var.feature_flag_name
    REPLICA_REGIONS   = concat([var.aws_region], local.storage_replica_regions)
  })
  filename             = "${path.module}/../edge/config.json"
  file_permission      = "0644"
  directory_permission = "0755"
}
