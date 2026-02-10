# AWS Lambda Proxy for FullCAM API

This Lambda function proxies requests to the FullCAM API to avoid CORS issues.

## Deployment Steps

### 1. Build and Package

```bash
cd lambda
npm install
npm run build
npm run package
```

This creates `lambda.zip` ready for upload.

### 2. Create Lambda Function (AWS Console)

1. Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda/)
2. Click **"Create function"**
3. Choose **"Author from scratch"**
4. Settings:
   - **Function name**: `fullcam-api-proxy`
   - **Runtime**: Node.js 20.x
   - **Architecture**: x86_64
5. Click **"Create function"**

### 3. Upload Code

1. In the Lambda function page, go to **"Code"** tab
2. Click **"Upload from"** → **".zip file"**
3. Upload the `lambda.zip` file
4. Click **"Save"**

### 4. Configure Lambda

1. Go to **"Configuration"** → **"General configuration"**
2. Click **"Edit"**
3. Set **Timeout** to 30 seconds (API calls can take time)
4. Click **"Save"**

### 5. Create API Gateway

1. Go to [API Gateway Console](https://console.aws.amazon.com/apigateway/)
2. Click **"Create API"**
3. Choose **"HTTP API"** → **"Build"**
4. Click **"Add integration"**
5. Choose **"Lambda"**
6. Select your `fullcam-api-proxy` function
7. **API name**: `fullcam-proxy-api`
8. Click **"Next"**

### 6. Configure Routes

1. **Method**: POST
2. **Resource path**: `/api/run-simulation`
3. **Integration target**: Your Lambda function
4. Click **"Next"**
5. Skip stages (use default `$default`)
6. Click **"Create"**

### 7. Add Route for Spatial Update

1. In API Gateway, click **"Routes"**
2. Click **"Create"**
3. **Method**: POST
4. **Path**: `/api/update-spatial`
5. **Integration**: Choose your Lambda function
6. Click **"Create"**

### 8. Enable CORS

1. In API Gateway, click **"CORS"**
2. Click **"Configure"**
3. Add your Amplify domain: `https://main.dmyr5krb8p2x2.amplifyapp.com`
4. Add `*` for development
5. Click **"Save"**

### 9. Get API URL

1. In API Gateway, go to **"Stages"**
2. Click on **"$default"**
3. Copy the **Invoke URL** (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com`)

### 10. Update Amplify Environment Variable

1. Go to AWS Amplify Console
2. Your app → **"Environment variables"**
3. Add or update: `VITE_API_PROXY_URL` = Your API Gateway URL
4. Click **"Save"**
5. Redeploy your app

## Testing

Test locally:
```bash
curl -X POST https://your-api-gateway-url/api/run-simulation \
  -H "Content-Type: application/json" \
  -d '{
    "plotContent": "your plot xml content",
    "filename": "test.plo",
    "subscriptionKey": "your-key"
  }'
```

## Monitoring

View Lambda logs in CloudWatch:
1. Lambda Console → Your function → **"Monitor"** tab
2. Click **"View CloudWatch logs"**
