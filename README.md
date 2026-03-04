# Edge redirect with Lambda@Edge + DynamoDB Global Tables

Replicates the [Split Cloudflare Workers template](https://github.com/splitio/cloudflare-workers-template) using **Lambda@Edge** and **DynamoDB Global Tables** instead of Cloudflare Workers and Durable Objects.

- **Redirect at the edge**: CloudFront viewer-request invokes Lambda@Edge, which runs the **full Split/FME SDK** in `consumer_partial` mode, reads the rollout plan from the **nearest DynamoDB Global Table replica**, evaluates `getTreatment(key, featureFlag)`, and returns an HTML page showing the redirect target (or you can change it to a 302).
  - **Treatment `on`** → `https://google.com`
  - **Treatment `off`** (or control) → `https://apple.com`
- **Sync Lambda**: Runs on a schedule and populates DynamoDB with the rollout plan via the Split Synchronizer (DynamoDB storage wrapper). 
## Architecture

- **CloudFront** – Viewer-request → Lambda@Edge.
- **Lambda@Edge** – Full Split/FME SDK + DynamoDB wrapper; uses `AWS_REGION` so the DynamoDB client hits the **nearest Global Table replica** (lower latency).
- **DynamoDB Global Table** – One table with replicas in multiple regions (US, EU, APAC, SA). Sync writes in the primary region; edge reads from the nearest replica, or a fallback region when the edge runs in a region without a replica.
- **Sync Lambda** – EventBridge schedule → Synchronizer only (writes rollout plan to DynamoDB).

---

## How to run the demo

### 1. Prerequisites

- **AWS CLI** configured (`aws configure` or env vars).
- **Terraform** >= 1.0.
- **Node.js 20** (Terraform will run `npm ci` and zip the Lambdas).
- **Harness account**: Create a **feature flag** in FME and get a **server-side SDK key** (same environment as the flag).

### 2. Create the feature flag in Split

1. In Harness FME (e.g. [Harness Feature Flags](https://harness.io)) create a feature flag (e.g. `my_feature`).
2. Define at least two treatments: **on** and **off**.
3. Set the default rule or targeting rules as you like (e.g. 100% on, or by key).
4. Copy the **server-side SDK key** for that environment (FME Settings → SDK keys → Server-side key).

### 3. Deploy with Terraform

Terraform packages the Lambdas by running `npm ci` in `edge/` and `sync/`, which **requires a `package-lock.json` in each directory**. Generate the lockfiles once from the repo root:

```bash
cd edge && npm install && cd ..
cd sync && npm install && cd ..
```

Then deploy. From the repo root:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and set:

```hcl
split_sdk_key = "YOUR_SPLIT_SERVER_SIDE_SDK_KEY"
# Optional: feature_flag_name = "my_feature"   # must match the flag name in Split
```

Deploy (Terraform will run `npm ci` and zip for both Lambdas, then create DynamoDB, Lambdas, CloudFront, EventBridge):

```bash
terraform init
terraform apply -var-file=terraform.tfvars
```

Confirm with `yes`. Note the outputs: `cloudfront_domain`, `cloudfront_url`, `sync_lambda_name`.

### 4. Run the first sync

The sync Lambda runs on a schedule (e.g. every 5 minutes). To have data immediately, invoke it once:

```bash
aws lambda invoke --function-name $(terraform output -raw sync_lambda_name) out.json
cat out.json
```

You should see `{"ok":true,"message":"Synchronization finished"}`. If you see an error, check that `SPLIT_SDK_KEY` is correct and the flag name exists.

### 5. Test the redirect

Use the CloudFront URL from the Terraform output:

```bash
# Replace with your CloudFront domain from: terraform output cloudfront_domain
curl -I "https://YOUR_DISTRIBUTION.cloudfront.net/"
```

You should get **200** with an HTML page showing the redirect target (and treatment/key). Depending on the treatment for the default key, it will show `google.com` or `apple.com`.

**Per-user key** (optional): the edge reads the key from the query string. If your flag is set up to segment by key:

```bash
curl -I "https://YOUR_DISTRIBUTION.cloudfront.net/?key=user123"
curl -I "https://YOUR_DISTRIBUTION.cloudfront.net/?key=user456"
```

Different keys can get different treatments (and thus different redirects) based on your Harness FME targeting rules.

### 6. Toggle the flag in Harness

- In Harness FME, change the flag to **off** (or adjust targeting).
- Wait for the next scheduled sync (e.g. 5 minutes), or invoke the sync Lambda again.
- Hit the same CloudFront URL again; the redirect should reflect the new treatment.

---

## Project layout

- `terraform/` – DynamoDB Global Table, sync Lambda, Lambda@Edge, CloudFront, EventBridge.
- `sync/` – Sync Lambda: DynamoDB storage wrapper + Split Synchronizer only.
- `edge/` – Lambda@Edge: full Split/FME SDK + DynamoDB wrapper, evaluates `getTreatment` at the edge.


