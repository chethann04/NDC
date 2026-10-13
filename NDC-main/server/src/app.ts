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
import emailService from './services/EmailService';

import { sanitizeInput } from './middleware/sanitizeInput';
import { generalApiLimiter } from './middleware/rateLimiter';
import { authenticateToken } from './middleware/auth';
import { authorizeRoles } from './middleware/rbac';
import { UserRole } from './constants/roles';

dotenv.config();

const app: Application = express();

// Disable x-powered-by to prevent Express version leakage
app.disable('x-powered-by');

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
        /\.vercel\.app$/.test(origin);

      if (isAllowed) {
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
  const isConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_USER !== 'your-email@gmail.com');
  const testResult = isConfigured ? await emailService.testConnection() : { success: false, message: 'SMTP environment variables not configured in Render.' };

  res.status(200).json({
    status: 'OK',
    system: 'No Due Certificate Management System',
    time: new Date(),
    smtp: {
      configured: isConfigured,
      user: process.env.SMTP_USER ? `${process.env.SMTP_USER.slice(0, 4)}***@${process.env.SMTP_USER.split('@')[1] || ''}` : 'Not set',
      test: testResult
    }
  });
});

// Diagnostic endpoint to send a live test clearance email (strictly restricted to Super Admins)
app.get('/api/v1/health/send-test-email', authenticateToken, authorizeRoles(UserRole.SUPER_ADMIN), async (req, res) => {
  const targetEmail = (req.query.to as string) || process.env.SMTP_USER;
  if (!targetEmail) {
    res.status(400).json({ error: 'Please specify ?to=your_email@gmail.com' });
    return;
  }

  const success = await emailService.sendClearanceUpdateEmail({
    toEmail: targetEmail,
    studentName: 'Diagnostic Test Student',
    usn: '4MC24IS022',
    departmentName: 'Central Library',
    status: 'CLEARED',
    remarks: 'Live test email dispatched from deployed server',
    clearedCount: 1,
    totalCount: 6
  });

  res.status(200).json({
    attempted: true,
    sent: success,
    sentTo: targetEmail,
    notice: success ? 'Email dispatched! Check your inbox/spam folder.' : 'Email failed. Verify your SMTP credentials in Render.'
  });
});

// Global Error Handler
app.use(errorHandler);

export default app;
