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

dotenv.config(); // Reloaded with high-speed direct connection pool

const app: Application = express();

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
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xXssProtection: true,
  })
);

// Gzip/Deflate response compression for faster API transfers
app.use(compression({ threshold: 1024 }));

app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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

// Health check endpoint with diagnostic info
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    system: 'No Due Certificate Management System',
    time: new Date(),
    smtpUser: process.env.SMTP_USER,
    smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_USER !== 'your-email@gmail.com')
  });
});

// Global Error Handler
app.use(errorHandler);

export default app;
