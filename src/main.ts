import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import passport from 'passport';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Request, Response, Express as ExpressType } from 'express';

let cachedServer: ExpressType;

async function bootstrap() {
    if (cachedServer) {
        console.log('[Backend] Using cached server instance.');
        return cachedServer;
    }
    console.log('[Backend] Creating new server instance.');

    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

    // --- Passport Initialization (still needed for JWT strategy) ---
    app.use(passport.initialize());
    // app.use(passport.session()); // No longer needed if not using sessions

    console.log('[Backend] Passport initialized for JWT.');


    // --- CORS Configuration ---
    const frontendUrl = process.env.FRONTEND_URL;
    console.log(`[Backend] Configuring CORS. FRONTEND_URL from env: ${frontendUrl}`);
    const allowedOrigins = ['https://paggo-ocr-case-ochre.vercel.app', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];
    if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
        allowedOrigins.push(frontendUrl);
    }
    console.log('[Backend] Effective allowed origins for CORS:', allowedOrigins);

    app.enableCors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed))) {
                callback(null, true);
            } else {
                console.warn(`[Backend] CORS: Blocked origin - ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true, // Keep true if frontend sends cookies for other reasons, or for future use. For JWT Bearer token, it's not strictly necessary for auth itself.
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'], // Ensure 'Authorization' is allowed
    });
    console.log('[Backend] CORS configured.');

    // --- Global Pipes ---
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }),
    );
    console.log('[Backend] Global validation pipe set.');

    // --- Initialize NestJS Application ---
    await app.init();
    console.log('[Backend] Nest application fully initialized.');

    cachedServer = expressApp;
    return expressApp;
}

export default async (req: Request, res: Response) => {
    const server = await bootstrap();
    server(req, res);
};

async function localDevelopment() {
    console.log('[Backend] main.ts execution started for local development');
    const server = await bootstrap();
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`[Backend] Local development: Application is running on: http://localhost:${port}`);
        console.log(`[Backend] Try accessing http://localhost:${port}/`);
    });
}

if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test' && require.main === module) {
    localDevelopment().catch(err => {
        console.error('[Backend] Error during local development startup:', err);
        process.exit(1);
    });
}