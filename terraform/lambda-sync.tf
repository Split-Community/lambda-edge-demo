# Package sync Lambda (npm install + zip)
resource "null_resource" "sync_package" {
  triggers = {
    index_js              = filemd5("${path.module}/../sync/index.js")
    dynamodb_wrapper_js   = filemd5("${path.module}/../sync/dynamodb-storage-wrapper.js")
    package_json          = filemd5("${path.module}/../sync/package.json")
  }
  provisioner "local-exec" {
    command = <<-EOT
      BUILD_DIR="${abspath(path.module)}/build" && \
      mkdir -p "$${BUILD_DIR}" && \
      cd "${path.module}/../sync" && \
      npm ci --omit=dev && \
      zip -r "$${BUILD_DIR}/sync.zip" index.js dynamodb-storage-wrapper.js node_modules/
    EOT
  }
  depends_on = [null_resource.build_dir]
}

# Pre-create build dir for zip output
resource "null_resource" "build_dir" {
  provisioner "local-exec" {
    command = "mkdir -p ${path.module}/build"
  }
  triggers = {}
}

# IAM role for sync Lambda
resource "aws_iam_role" "sync" {
  name = "${local.name}-sync"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "sync" {
  name   = "${local.name}-sync"
  role   = aws_iam_role.sync.id
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
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"]
        Resource = [aws_dynamodb_table.storage.arn, "${aws_dynamodb_table.storage.arn}/index/*"]
      }
    ]
  })
}

resource "aws_lambda_function" "sync" {
  filename         = "${path.module}/build/sync.zip"
  function_name    = "${local.name}-sync"
  role             = aws_iam_role.sync.arn
  handler          = "index.handler"
  source_code_hash = base64sha256(join("", [
    filemd5("${path.module}/../sync/index.js"),
    filemd5("${path.module}/../sync/dynamodb-storage-wrapper.js"),
    filemd5("${path.module}/../sync/package.json"),
  ]))
  runtime = "nodejs20.x"
  timeout          = 60

  environment {
    variables = {
      TABLE_NAME    = aws_dynamodb_table.storage.name
      SPLIT_SDK_KEY = var.split_sdk_key
    }
  }

  depends_on = [
    null_resource.sync_package,
    aws_iam_role_policy.sync,
  ]
}

# EventBridge schedule to run sync periodically
resource "aws_cloudwatch_event_rule" "sync_schedule" {
  name                = "${local.name}-sync"
  description         = "Run sync Lambda every ${var.sync_schedule_rate_minutes} minutes"
  schedule_expression = "rate(${var.sync_schedule_rate_minutes} minutes)"
}

resource "aws_cloudwatch_event_target" "sync" {
  rule      = aws_cloudwatch_event_rule.sync_schedule.name
  target_id = "sync"
  arn       = aws_lambda_function.sync.arn
}

resource "aws_lambda_permission" "sync_schedule" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sync_schedule.arn
}
