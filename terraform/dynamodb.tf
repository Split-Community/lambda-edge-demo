# Global Table: replicas in multiple regions so Lambda@Edge can read from nearest region.
# Stream required for global table replication.
resource "aws_dynamodb_table" "storage" {
  name             = "${local.name}-storage"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "pk"
  range_key        = "sk"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Replicas (table primary is in var.aws_region). Common regions so Lambda@Edge often hits a local replica.
  dynamic "replica" {
    for_each = local.storage_replica_regions
    content {
      region_name = replica.value
    }
  }

  tags = {
    Name = local.name
  }
}
