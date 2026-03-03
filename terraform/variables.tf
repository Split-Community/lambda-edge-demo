variable "aws_region" {
  description = "AWS region for DynamoDB and sync Lambda"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name used for resource names"
  type        = string
  default     = "edge-redirect"
}

variable "split_sdk_key" {
  description = "Split server-side SDK key (for sync Lambda)"
  type        = string
  sensitive   = true
}

variable "feature_flag_name" {
  description = "Split feature flag name to evaluate for redirect"
  type        = string
  default     = "my_feature"
}

variable "bucketing_key" {
  description = "Fixed key used to resolve treatment (one treatment for all users)"
  type        = string
  default     = "default"
}

variable "sync_schedule_rate_minutes" {
  description = "How often to run the sync Lambda (minutes)"
  type        = number
  default     = 5
}

