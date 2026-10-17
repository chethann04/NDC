# Google Apps Script Email Delivery Setup Guide for NDC

This guide walks you through deploying the Google Apps Script email delivery service and configuring it on Render.

---

## Why Google Apps Script?

1. **Bypasses Render Outbound SMTP Blocks**: Render's Free tier blocks all outbound TCP traffic on ports `25`, `465`, and `587` (causing `connect ENETUNREACH`). Google Apps Script Web Apps communicate over standard **HTTPS (port 443)**, which is completely open on Render Free.
2. **No Custom Domain or Resend Required**: Google's `MailApp.sendEmail()` sends directly from your Google account to **any dynamic student recipient** (`@gmail.com`, `@mcehassan.ac.in`, etc.) without requiring custom domain DNS verification (DKIM/SPF) or third-party accounts.
3. **Completely Free**: Uses your existing Google/Gmail account.

---

## Important Architectural Notes for Developers

### 1. HTTP Status Codes vs JSON `statusCode`
> [!IMPORTANT]
> **Google Apps Script's `ContentService.createTextOutput()` DOES NOT set the HTTP response status code at the HTTP envelope level.**
> 
> All successful Web App executions (including 302/303 redirects) return **HTTP 200** on the wire.
> - The `statusCode` property returned by `respondJson()` (e.g. `200`, `400`, `401`, `429`, `500`) is strictly an **application-level field** inside the parsed JSON response body.
> - The NDC backend **never relies on `response.status`** to confirm delivery. It explicitly inspects `result.success === true` and confirms that a valid `messageId` exists.
> - The NDC backend uses standard `fetch` with `redirect: 'follow'` to automatically follow Google's 302 redirect from `script.google.com` to `script.googleusercontent.com`.

### 2. Public `doGet()` Health Check
- The public `doGet()` endpoint returns a minimal health confirmation (`{"status": "ONLINE", "service": "NDC Email Service"}`).
- Quota metrics and secret configuration statuses are **not exposed** in `doGet()` to prevent unauthorized information disclosure.

---

## Step 1: Create the Google Apps Script Project

1. Open your browser and navigate to [https://script.google.com/](https://script.google.com/).
2. Click **+ New project** (top-left).
3. In the top-left title, change `Untitled project` to **`NDC Email Service`**.
4. In the code editor, delete any starter code in `Code.gs` and paste the entire contents of [`apps-script/Code.gs`](Code.gs).

---

## Step 2: Configure Script Properties (Shared Secret)

The shared secret prevents unauthorized users from calling your script.

1. On the left sidebar of the Apps Script editor, click the **Project Settings** icon (gear icon ⚙️).
2. Scroll down to the **Script Properties** section.
3. Click **Add script property**.
   - **Property**: `APPS_SCRIPT_SECRET`
   - **Value**: Enter a strong random secret token (e.g. `ndc_sec_9f7a2b1c4e8d30a6f81e7d5c92b4`).
4. Click **Save script properties**.

> [!NOTE]
> Save this secret token somewhere secure. You will need to paste this exact value into your Render environment variables.

---

## Step 3: Deploy as a Web App

1. In the top-right corner of the Apps Script editor, click **Deploy** -> **New deployment**.
2. Click the gear icon ⚙️ next to "Select type" and choose **Web app**.
3. Fill in the deployment settings:
   - **Description**: `NDC Production Email Delivery`
   - **Execute as**: **`Me (your-email@gmail.com)`** *(CRITICAL: Must be "Me" so that emails send using your Gmail identity)*.
   - **Who has access**: **`Anyone`** *(CRITICAL: Must be "Anyone" so Render's backend can reach the endpoint over HTTPS without interactive Google OAuth login prompts. Security is enforced by your shared secret)*.
4. Click **Deploy**.
5. **Authorize Access**:
   - Google will show an "Authorization required" modal. Click **Authorize access**.
   - Select your Google account.
   - If Google shows a warning ("Google hasn't verified this app"), click **Advanced** -> **Go to NDC Email Service (unsafe)**.
   - Click **Allow**.
6. Copy the **Web App URL**. It will look like:
   ```text
   https://script.google.com/macros/s/AKfycbz_exampleDeploymentId1234567890/exec
   ```

---

## Step 4: Configure Render Environment Variables

1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Select your NDC backend Web Service (`ndc-backend`).
3. Click **Environment** in the left menu.
4. Add or update the following environment variables:

| Variable Name | Value | Description |
| :--- | :--- | :--- |
| `EMAIL_PROVIDER` | `apps_script` | Enables Google Apps Script HTTPS delivery |
| `GOOGLE_APPS_SCRIPT_URL` | `https://script.google.com/macros/s/.../exec` | Your Web App URL from Step 3 (or legacy `APPS_SCRIPT_URL`) |
| `GOOGLE_APPS_SCRIPT_SECRET` | `ndc_sec_9f7a2b1c4e8d30a6f81e7d5c92b4` | The exact secret you saved in Step 2 (or legacy `APPS_SCRIPT_SECRET`) |
| `EMAIL_SENDER_NAME` | `MCE No Due Portal` | Friendly sender name displayed to students |
| `TRUST_PROXY` | `1` | Ensures correct Express proxy IP handling |

> [!NOTE]
> **Remove legacy SMTP variables from Render:**
> In your Render Environment settings, delete `SMTP_USER` and `SMTP_PASS` (e.g. `4MC24IS022@gmail.com`). This ensures no SMTP configuration remains in the environment.

5. Click **Save Changes**. Render will automatically restart your web service with the new configuration.

---

## Step 5: Verification & Testing

### 1. Direct Web App Health Check
Paste your Web App URL into your browser address bar:
```text
https://script.google.com/macros/s/AKfycb.../exec
```
You should receive a clean JSON response:
```json
{
  "status": "ONLINE",
  "service": "NDC Email Service",
  "timestamp": "2026-10-16T14:45:00.000Z"
}
```

### 2. Backend Health Check
Visit your deployed backend `/api/v1/health` endpoint:
```text
https://<your-render-service>.onrender.com/api/v1/health
```
The response will show:
```json
{
  "status": "OK",
  "email": {
    "provider": "Google Apps Script",
    "configured": true,
    "test": {
      "success": true,
      "provider": "Google Apps Script",
      "message": "Google Apps Script HTTPS connection verified successfully (NDC Email Service).",
      "mode": "live"
    }
  }
}
```

### 3. Send a Live Test Email
Trigger a live test clearance notification to your email:
```bash
curl -X POST "https://<your-render-service>.onrender.com/api/v1/health/send-test-email" \
     -H "Content-Type: application/json" \
     -d '{"to": "your_email@gmail.com"}'
```
Check your inbox for the clearance notification!

---

## Quotas and Limitations

| Account Type | Daily Sending Quota | Reset Time |
| :--- | :--- | :--- |
| Personal Google Account (`@gmail.com`) | **100 emails / day** | Midnight Pacific Time (PT) |
| Google Workspace (`@yourcollege.edu.in`) | **1,500 emails / day** | Midnight Pacific Time (PT) |

### Best Practices:
- **Batch Clearance Updates**: NDC includes built-in rate throttling (550ms between requests) in `EmailService.sendClearanceUpdateEmailsBatch` to keep your sending smooth and prevent burst rate limits.
- **Updating Script Code**: If you ever update `Code.gs`, click **Deploy** -> **Manage deployments** -> edit your deployment -> change Version to **New version** -> click **Deploy**. The Web App URL will remain the same.
