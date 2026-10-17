import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/authRoutes';
import studentRoutes from './routes/studentRoutes';
import departmentRoutes from './routes/departmentRoutes';
import officerRoutes from './routes/officerRoutes';
import ndcRoutes from './routes/ndcRoutes';
import certificateRoutes from './routes/certificateRoutes';
import verifyRoutes from './routes/verifyRoutes';
import reportRoutes from './routes/reportRoutes';
import auditRoutes from './routes/auditRoutes';
import settingRoutes from './routes/settingRoutes';
import teachingDepartmentRoutes from './routes/teachingDepartmentRoutes';
import sectionLoginRoutes from './routes/sectionLoginRoutes';
import jobRoutes from './routes/jobRoutes';
import aiRoutes from './routes/aiRoutes';
import emailService from './services/EmailService';
import { setLastKnownClientOrigin, extractOriginFromReq } from './utils/urlHelper';

import { sanitizeInput } from './middleware/sanitizeInput';
import { generalApiLimiter } from './middleware/rateLimiter';
import { authenticateToken } from './middleware/auth';
import { authorizeRoles } from './middleware/rbac';
import { UserRole } from './constants/roles';

dotenv.config();

const app: Application = express();

// Disable x-powered-by to prevent Express version leakage
app.disable('x-powered-by');

/**
 * Express Reverse Proxy Configuration ('trust proxy')
 * 
 * Deployment Topology & Proxy Resolution:
 * - The backend is deployed on Render (web service behind Render's ingress reverse proxy).
 * - Render routes public HTTPS traffic through an ingress reverse proxy before reaching Express.
 * - The Render proxy forwards requests and attaches the 'X-Forwarded-For' header with the real client IP.
 * - When 'trust proxy' is false (Express default), Express ignores 'X-Forwarded-For', causing req.ip to
 *   fall back to the internal proxy's IP. This breaks IP-based rate limiting (all users share one quota)
 *   and causes express-rate-limit to fail with ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
 * - Blindly setting 'trust proxy: true' is unsafe because an attacker can spoof arbitrary upstream IPs.
 * - Setting 'trust proxy: 1' tells Express to trust the single immediate front-facing reverse proxy (Render),
 *   allowing Express to extract the genuine client IP safely from the right-most untrusted entry in X-Forwarded-For.
 * - For custom topologies (e.g. Cloudflare in front of Render = 2 hops, or custom subnets), TRUST_PROXY
 *   environment variable can be supplied to override the default 1 hop.
 */
const resolveTrustProxySetting = (): boolean | number | string => {
  const envVal = process.env.TRUST_PROXY?.trim();
  if (!envVal) {
    // Default: trust 1 hop (Render's edge reverse proxy)
    return 1;
  }
  if (envVal.toLowerCase() === 'true') return true;
  if (envVal.toLowerCase() === 'false') return false;
  const parsedNum = Number(envVal);
  if (!isNaN(parsedNum) && Number.isInteger(parsedNum) && parsedNum > 0) {
    return parsedNum;
  }
  return envVal;
};

app.set('trust proxy', resolveTrustProxySetting());

// Hardened Security & Cookie Headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://*.supabase.co", process.env.SUPABASE_URL || "https://your-supabase-project.supabase.co"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        frameSrc: ["'self'", "blob:"],
        objectSrc: ["'self'", "blob:"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xFrameOptions: { action: 'sameorigin' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xXssProtection: true,
  })
);

// Gzip/Deflate response compression for faster API transfers
app.use(compression({ threshold: 1024 }));

app.use(cookieParser());

// Whitelisted CORS Configuration
const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.APP_URL,
  'https://ndc-mce.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      const isAllowed =
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) ||
        /\.vercel\.app$/.test(origin) ||
        /\.netlify\.app$/.test(origin) ||
        /\.onrender\.com$/.test(origin);

      if (isAllowed) {
        setLastKnownClientOrigin(origin);
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Disposition']
  })
);

// Dynamically track active client origin for notifications and outbound emails
app.use((req, res, next) => {
  const origin = req.get('origin');
  const referer = req.get('referer');
  let detectedOrigin = origin;
  if (!detectedOrigin && referer) {
    try {
      detectedOrigin = new URL(referer).origin;
    } catch {
      // ignore
    }
  }
  if (detectedOrigin) {
    setLastKnownClientOrigin(detectedOrigin);
  }
  next();
});

// Normalize consecutive slashes in URLs (e.g. //api/v1 -> /api/v1)
app.use((req, res, next) => {
  if (req.url.startsWith('//')) {
    req.url = req.url.replace(/^\/+/, '/');
  }
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Input sanitization against XSS & prototype pollution
app.use(sanitizeInput);

// Global API rate limiting
app.use('/api/', generalApiLimiter);

// Prevent unauthenticated / accidental public access to internal logbook scans
app.use('/uploads/logbooks', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'Forbidden: Direct public access to logbook scans is not permitted. Access via authenticated scanner endpoints.'
  });
});

// Static directory for generated PDF certificates
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API v1 Router Registration
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/students', studentRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/officers', officerRoutes);
app.use('/api/v1/ndc', ndcRoutes);
app.use('/api/v1/certificates', certificateRoutes);
app.use('/api/v1/verify', verifyRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/teaching-department', teachingDepartmentRoutes);
app.use('/api/v1/admin/section-logins', sectionLoginRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/ai', aiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    message: 'NDC Backend API is running successfully.',
    healthCheck: '/api/v1/health',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint with diagnostic info
app.get('/api/v1/health', async (req, res) => {
  const isConfigured = emailService.isConfigured();
  const testResult = await emailService.testConnection();

  res.status(200).json({
    status: 'OK',
    system: 'No Due Certificate Management System',
    time: new Date(),
    email: {
      provider: testResult.provider,
      configured: isConfigured,
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'MCE No Due Portal',
      test: testResult
    }
  });
});

// Diagnostic endpoint to send a live test clearance email
const handleSendTestEmail = async (req: any, res: any) => {
  const targetEmail = (req.body?.to || req.query?.to) as string;
  if (!targetEmail) {
    res.status(400).json({ error: 'Please specify "to" in JSON body or ?to=your_verified_email@domain.com query' });
    return;
  }

  const clientUrl = extractOriginFromReq(req);
  const activeProvider = emailService.getActiveProvider();
  const providerLabel = activeProvider === 'apps_script'
    ? 'Google Apps Script'
    : activeProvider === 'resend'
    ? 'Resend'
    : activeProvider === 'mock'
    ? 'Mock'
    : 'Email Service';

  const sendRes = await emailService.sendMailDetailed({
    to: targetEmail,
    subject: `✓ [NDC Update] Central Library: Cleared (No Due) - 4MC24IS022`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f0fdf4; border-radius: 8px; color: #1e293b;">
        <h2 style="color: #047857;">MCE No Due Portal: Live ${providerLabel} Delivery Verification</h2>
        <p>Congratulations! This test clearance update confirms your email delivery integration is actively working and delivering on Render.</p>
        <p><strong>Provider:</strong> ${providerLabel}</p>
        <p><strong>Target:</strong> ${targetEmail}</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </div>
    `
  });

  res.status(200).json({
    attempted: true,
    sent: sendRes.success,
    sentTo: targetEmail,
    messageId: sendRes.messageId,
    error: sendRes.error,
    provider: providerLabel,
    notice: sendRes.success
      ? `Email successfully accepted by ${providerLabel}! Check your inbox.`
      : `Email rejected by ${providerLabel}: ${sendRes.error}`
  });
};

app.post('/api/v1/health/send-test-email', handleSendTestEmail);
app.get('/api/v1/health/send-test-email', handleSendTestEmail);

// Global Error Handler
app.use(errorHandler);

export default app;
