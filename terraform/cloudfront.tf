# Dummy origin (required by CloudFront). Viewer-request Lambda returns redirect so origin is rarely hit.
resource "aws_s3_bucket" "dummy" {
  bucket = "${local.name}-dummy-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_ownership_controls" "dummy" {
  bucket = aws_s3_bucket.dummy.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "dummy" {
  bucket                  = aws_s3_bucket.dummy.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "dummy" {
  name                              = "${local.name}-oac"
  description                       = "OAC for dummy S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "dummy" {
  bucket = aws_s3_bucket.dummy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipal"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.dummy.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.redirect.arn
        }
      }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.dummy]
}

resource "aws_cloudfront_distribution" "redirect" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = ""
  comment             = "Edge redirect - feature flag to google/apple"

  origin {
    domain_name              = aws_s3_bucket.dummy.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.dummy.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.dummy.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.dummy.id}"
    viewer_protocol_policy = "allow-all"
    compress               = true

    forwarded_values {
      query_string = true
      headers      = []
      cookies {
        forward = "none"
      }
    }

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.edge.qualified_arn
      include_body = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = local.name
  }
}
