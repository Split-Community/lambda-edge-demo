output "cloudfront_domain" {
  description = "CloudFront distribution domain (use this URL to test redirect)"
  value       = aws_cloudfront_distribution.redirect.domain_name
}

output "cloudfront_url" {
  description = "CloudFront distribution URL"
  value       = "https://${aws_cloudfront_distribution.redirect.domain_name}"
}

output "dynamodb_table" {
  description = "DynamoDB table name (storage + resolved_treatment)"
  value       = aws_dynamodb_table.storage.name
}

output "sync_lambda_name" {
  description = "Sync Lambda function name (invoke manually for first sync)"
  value       = aws_lambda_function.sync.function_name
}
