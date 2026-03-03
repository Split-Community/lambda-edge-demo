# Package edge Lambda (full Split SDK + DynamoDB wrapper). Config baked in (Lambda@Edge has no env vars).
resource "null_resource" "edge_package" {
  triggers = {
    index_js     = filemd5("${path.module}/../edge/index.js")
    wrapper_js   = filemd5("${path.module}/../edge/dynamodb-storage-wrapper.js")
    package_json = filemd5("${path.module}/../edge/package.json")
    config       = local_file.edge_config.content
  }
  provisioner "local-exec" {
    command = <<-EOT
      BUILD_DIR="${abspath(path.module)}/build" && \
      mkdir -p "$${BUILD_DIR}" && \
      cd "${path.module}/../edge" && \
      npm ci --omit=dev && \
      zip -r "$${BUILD_DIR}/edge.zip" index.js dynamodb-storage-wrapper.js config.json node_modules/
    EOT
  }
  depends_on = [null_resource.build_dir, local_file.edge_config]
}

# IAM role for Lambda@Edge (must be in us-east-1)
resource "aws_iam_role" "edge" {
  provider = aws.us_east_1

  name = "${local.name}-edge"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = [
          "lambda.amazonaws.com",
          "edgelambda.amazonaws.com"
        ]
      }
    }]
  })
}

resource "aws_iam_role_policy" "edge" {
  provider = aws.us_east_1

  name   = "${local.name}-edge"
  role   = aws_iam_role.edge.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
        Resource = [aws_dynamodb_table.storage.arn, "${aws_dynamodb_table.storage.arn}/index/*"]
      }
    ]
  })
}

# Lambda@Edge must be in us-east-1
resource "aws_lambda_function" "edge" {
  provider = aws.us_east_1

  filename         = "${path.module}/build/edge.zip"
  function_name    = "${local.name}-edge"
  role             = aws_iam_role.edge.arn
  handler          = "index.handler"
  source_code_hash = base64sha256(join("", [
    filemd5("${path.module}/../edge/index.js"),
    filemd5("${path.module}/../edge/dynamodb-storage-wrapper.js"),
    filemd5("${path.module}/../edge/package.json"),
    local_file.edge_config.content,
  ]))
  runtime = "nodejs20.x"
  timeout     = 5
  memory_size = 128
  publish     = true

  # Lambda@Edge does not support environment variables; config is in config.json in the package.

  depends_on = [
    null_resource.edge_package,
    aws_iam_role_policy.edge,
  ]
}
