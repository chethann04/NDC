import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';

const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

process.on('uncaughtException', (err) => {
  console.error('[Backend Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Backend Unhandled Rejection]:', reason);
});

const startServer = async () => {
  app.listen(PORT, HOST, () => {
    console.log(`[NDC Backend Server Running]: http://${HOST}:${PORT}`);
    console.log(`[Health Check]: http://${HOST}:${PORT}/api/v1/health`);
  });

  try {
    await connectDB();
  } catch (err) {
    console.error('[Initial DB connect error]:', err);
  }
};

startServer();
