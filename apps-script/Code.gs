/**
 * NDC Digital No Due Certificate - Google Apps Script Email Delivery Service
 *
 * This script runs in Google Apps Script and provides a secure HTTPS endpoint (Port 443)
 * for sending clearance emails via Gmail (MailApp) without encountering Render SMTP
 * network blocks or requiring a custom domain.
 *
 * Setup:
 * 1. Open https://script.google.com/ and create a new project named "NDC Email Service".
 * 2. Paste this code into Code.gs.
 * 3. Go to Project Settings -> Script Properties -> Add property:
 *      Property: GOOGLE_APPS_SCRIPT_SECRET (or APPS_SCRIPT_SECRET)
 *      Value: <generate a 32+ character random secret token>
 * 4. Click Deploy -> New deployment:
 *      Select type: Web app
 *      Description: Production NDC Email Service
 *      Execute as: Me (<your-account>@gmail.com)
 *      Who has access: Anyone
 * 5. Copy the Web App URL (starts with https://script.google.com/macros/s/.../exec).
 * 6. Add to Render Environment Variables:
 *      EMAIL_PROVIDER=apps_script
 *      GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
 *      GOOGLE_APPS_SCRIPT_SECRET=<your secret token>
 */

function getScriptSecret() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('GOOGLE_APPS_SCRIPT_SECRET') || 
         props.getProperty('APPS_SCRIPT_SECRET') || 
         props.getProperty('AUTH_SECRET') || '';
}

/**
 * Safely retrieve remaining daily email quota without throwing
 * if MailApp service encounters temporary degradation. Returns null on failure.
 */
function safeGetRemainingQuota() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (quotaErr) {
    return null;
  }
}

/**
 * Handle HTTP GET requests - Public service health check.
 *
 * NOTE: Quota counts and secret configuration details are intentionally omitted from
 * the public GET response to prevent unauthorized enumeration or metrics exposure.
 */
function doGet(e) {
  var result = {
    status: 'ONLINE',
    service: 'NDC Email Service',
    timestamp: new Date().toISOString()
  };

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle HTTP POST requests - Authenticated email dispatch
 */
function doPost(e) {
  var startTime = new Date().getTime();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respondJson(400, {
        success: false,
        error: 'INVALID_REQUEST: Missing request body'
      });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return respondJson(400, {
        success: false,
        error: 'MALFORMED_JSON: Request body is not valid JSON'
      });
    }

    if (!data || typeof data !== 'object') {
      return respondJson(400, {
        success: false,
        error: 'INVALID_PAYLOAD: JSON payload must be an object'
      });
    }

    // 1. Authenticate request using shared secret
    var expectedSecret = getScriptSecret();
    if (!expectedSecret) {
      return respondJson(500, {
        success: false,
        error: 'CONFIG_ERROR: GOOGLE_APPS_SCRIPT_SECRET is not configured in Script Properties'
      });
    }

    var providedSecret = (typeof data.secret === 'string' ? data.secret : (typeof data.token === 'string' ? data.token : ''));
    if (!providedSecret || providedSecret !== expectedSecret) {
      // Secure rejection - never leak the expected secret
      return respondJson(401, {
        success: false,
        error: 'UNAUTHORIZED: Invalid or missing authentication secret'
      });
    }

    // 2. Strict type validation for recipient, subject, bodies, and sender name
    if (typeof data.to !== 'string') {
      return respondJson(400, {
        success: false,
        error: 'INVALID_RECIPIENT: Recipient ("to") must be a valid email string'
      });
    }

    if (typeof data.subject !== 'string') {
      return respondJson(400, {
        success: false,
        error: 'INVALID_SUBJECT: Subject must be a string'
      });
    }

    if (data.html !== undefined && typeof data.html !== 'string' &&
        data.htmlBody !== undefined && typeof data.htmlBody !== 'string') {
      return respondJson(400, {
        success: false,
        error: 'INVALID_HTML: HTML body must be a string'
      });
    }

    if (data.text !== undefined && typeof data.text !== 'string' &&
        data.textBody !== undefined && typeof data.textBody !== 'string') {
      return respondJson(400, {
        success: false,
        error: 'INVALID_TEXT: Text body must be a string'
      });
    }

    if (data.senderName !== undefined && typeof data.senderName !== 'string' &&
        data.name !== undefined && typeof data.name !== 'string') {
      return respondJson(400, {
        success: false,
        error: 'INVALID_SENDER_NAME: Sender name must be a string'
      });
    }

    var recipient = data.to.trim();
    var subject = data.subject.trim();
    var htmlBody = (typeof data.html === 'string' ? data.html : (typeof data.htmlBody === 'string' ? data.htmlBody : ''));
    var textBody = (typeof data.text === 'string' ? data.text : (typeof data.textBody === 'string' ? data.textBody : ''));
    var senderName = (typeof data.senderName === 'string' ? data.senderName : (typeof data.name === 'string' ? data.name : 'MCE No Due Portal')).trim();

    // Standard email pattern check
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!recipient || !emailRegex.test(recipient)) {
      return respondJson(400, {
        success: false,
        error: 'INVALID_RECIPIENT: Recipient email address is malformed or invalid'
      });
    }

    if (!subject) {
      return respondJson(400, {
        success: false,
        error: 'INVALID_SUBJECT: Email subject cannot be empty'
      });
    }

    if (!htmlBody && !textBody) {
      return respondJson(400, {
        success: false,
        error: 'EMPTY_CONTENT: Email must contain non-empty html or text content'
      });
    }

    // 3. Verify daily quota safely
    var remainingQuota = safeGetRemainingQuota();
    if (remainingQuota !== null && remainingQuota <= 0) {
      return respondJson(429, {
        success: false,
        error: 'QUOTA_EXCEEDED: Google daily email sending limit reached (remaining: 0)',
        remainingQuota: 0
      });
    }

    // If text body was not provided, strip HTML tags for clean text fallback
    if (!textBody && htmlBody) {
      textBody = htmlBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                         .replace(/<[^>]+>/g, ' ')
                         .replace(/\s{2,}/g, ' ')
                         .trim();
    }

    // 4. Send email via Google MailApp
    var mailOptions = {
      to: recipient,
      subject: subject,
      body: textBody || subject,
      name: senderName
    };

    if (htmlBody) {
      mailOptions.htmlBody = htmlBody;
    }

    // Attachments support (base64 encoded)
    if (Array.isArray(data.attachments) && data.attachments.length > 0) {
      var blobs = [];
      for (var i = 0; i < data.attachments.length; i++) {
        var att = data.attachments[i];
        if (att && typeof att.content === 'string' && typeof att.filename === 'string') {
          var mime = att.contentType || 'application/octet-stream';
          var decoded = Utilities.base64Decode(att.content);
          blobs.push(Utilities.newBlob(decoded, mime, att.filename));
        }
      }
      if (blobs.length > 0) {
        mailOptions.attachments = blobs;
      }
    }

    MailApp.sendEmail(mailOptions);

    var remainingAfter = safeGetRemainingQuota();
    var messageId = 'gas_' + new Date().getTime() + '_' + Math.random().toString(36).substring(2, 8);

    return respondJson(200, {
      success: true,
      messageId: messageId,
      acceptedAt: new Date().toISOString(),
      remainingQuota: remainingAfter,
      durationMs: new Date().getTime() - startTime
    });

  } catch (err) {
    return respondJson(500, {
      success: false,
      error: 'DELIVERY_EXCEPTION: ' + (err.message || String(err)),
      remainingQuota: safeGetRemainingQuota()
    });
  }
}

/**
 * Helper to build JSON responses using ContentService.
 *
 * CRITICAL ARCHITECTURAL NOTE ON HTTP STATUS CODES:
 * Google Apps Script ContentService.createTextOutput() DOES NOT allow modifying the actual
 * HTTP response status code at the HTTP envelope level. All successful Web App executions
 * (and 302 redirects) return HTTP 200 on the wire.
 *
 * Therefore:
 * 1. The 'statusCode' property added below (e.g. 200, 400, 401, 429, 500) exists ONLY inside
 *    the parsed JSON response body.
 * 2. Clients (such as the NDC Render backend) MUST inspect the JSON body's 'success' field
 *    (result.success === true) rather than relying on HTTP response.status.
 */
function respondJson(statusCode, obj) {
  obj.statusCode = statusCode;
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
