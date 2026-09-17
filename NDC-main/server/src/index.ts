import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';

const PORT = process.env.PORT || 5000;

process.on('uncaughtException', (err) => {
  console.error('[Backend Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Backend Unhandled Rejection]:', reason);
});

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[NDC Backend Server Running]: http://localhost:${PORT}`);
    console.log(`[Health Check]: http://localhost:${PORT}/api/v1/health`);
  });
};

startServer();
