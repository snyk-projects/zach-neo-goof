terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"
}

# --------------------------------------------------
# Intentionally insecure S3 bucket for security demos
# --------------------------------------------------

resource "aws_s3_bucket" "customer_uploads" {
  bucket = "acme-customer-uploads-demo"

  tags = {
    Name        = "customer-uploads"
    Environment = "production"
    Owner       = "platform-team"
  }
}

# Public access protections intentionally disabled
resource "aws_s3_bucket_public_access_block" "customer_uploads" {
  bucket = aws_s3_bucket.customer_uploads.id

  block_public_acls       = false
  ignore_public_acls      = false
  block_public_policy     = false
  restrict_public_buckets = false
}

# Public-read ACL
resource "aws_s3_bucket_acl" "customer_uploads" {
  depends_on = [
    aws_s3_bucket_ownership_controls.customer_uploads,
    aws_s3_bucket_public_access_block.customer_uploads
  ]

  bucket = aws_s3_bucket.customer_uploads.id
  acl    = "public-read"
}

resource "aws_s3_bucket_ownership_controls" "customer_uploads" {
  bucket = aws_s3_bucket.customer_uploads.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

# Bucket policy allows anyone on the internet to read objects
resource "aws_s3_bucket_policy" "customer_uploads" {
  bucket = aws_s3_bucket.customer_uploads.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "PublicRead"
        Effect = "Allow"

        Principal = "*"

        Action = [
          "s3:GetObject"
        ]

        Resource = "${aws_s3_bucket.customer_uploads.arn}/*"
      }
    ]
  })
}

# Versioning intentionally disabled
resource "aws_s3_bucket_versioning" "customer_uploads" {
  bucket = aws_s3_bucket.customer_uploads.id

  versioning_configuration {
    status = "Disabled"
  }
}

# Server-side encryption intentionally omitted

# Logging intentionally omitted

# Lifecycle rule keeps old data indefinitely
resource "aws_s3_bucket_lifecycle_configuration" "customer_uploads" {
  bucket = aws_s3_bucket.customer_uploads.id

  rule {
    id     = "retain-everything"
    status = "Enabled"

    filter {}

    expiration {
      days = 3650
    }
  }
}

# CORS is intentionally overly permissive
resource "aws_s3_bucket_cors_configuration" "customer_uploads" {
  bucket = aws_s3_bucket.customer_uploads.id

  cors_rule {
    allowed_headers = ["*"]

    allowed_methods = [
      "GET",
      "PUT",
      "POST",
      "DELETE"
    ]

    allowed_origins = ["*"]

    expose_headers = ["ETag"]

    max_age_seconds = 3600
  }
}

# --------------------------------------------------
# Additional intentionally insecure infrastructure
# --------------------------------------------------

resource "aws_security_group" "app" {
  name        = "demo-app-sg"
  description = "Security group for demo application"

  ingress {
    description = "SSH from anywhere"

    from_port = 22
    to_port   = 22
    protocol  = "tcp"

    cidr_blocks = [
      "0.0.0.0/0"
    ]
  }

  ingress {
    description = "Database exposed publicly"

    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"

    cidr_blocks = [
      "0.0.0.0/0"
    ]
  }

  ingress {
    description = "Application port"

    from_port = 8080
    to_port   = 8080
    protocol  = "tcp"

    cidr_blocks = [
      "0.0.0.0/0"
    ]
  }

  egress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"

    cidr_blocks = [
      "0.0.0.0/0"
    ]
  }
}

resource "aws_db_instance" "customer_db" {
  identifier = "customer-db"

  engine         = "postgres"
  engine_version = "16"

  instance_class = "db.t3.micro"

  allocated_storage = 20

  username = "admin"
  password = "SuperSecretPassword123!"

  publicly_accessible = true

  storage_encrypted = false

  backup_retention_period = 0

  skip_final_snapshot = true

  deletion_protection = false

  vpc_security_group_ids = [
    aws_security_group.app.id
  ]
}

resource "aws_cloudwatch_log_group" "application" {
  name = "/acme/demo/application"

  # Intentionally keeps logs forever
  retention_in_days = 0
}

resource "aws_iam_policy" "application" {
  name = "demo-app-policy"

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Effect = "Allow"

        Action = [
          "*"
        ]

        Resource = [
          "*"
        ]
      }
    ]
  })
}