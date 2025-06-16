import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';
import passport from 'passport';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Request, Response, Express as ExpressType } from 'express';

let cachedServer: ExpressType;

async function bootstrap() {
    if (cachedServer) {
        return cachedServer;
    }

    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

    // Session middleware setup
    app.use(
        session({
            secret: process.env.SESSION_SECRET || 'a_very_secure_default_secret_for_dev_only_change_me', // Change this default
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 24 * 60 * 60 * 1000, // 1 day
                httpOnly: true,
                // Secure and SameSite settings for cross-origin session cookies
                secure: process.env.NODE_ENV === 'production', // Set to true if in production (HTTPS)
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-site, 'lax' for same-site or dev
            },
        }),
    );

    app.use(passport.initialize());
    app.use(passport.session());

    const frontendUrl = process.env.FRONTEND_URL;
    console.log(`[Backend] Configuring CORS. FRONTEND_URL from env: ${frontendUrl}`);

    const allowedOrigins = ['https://paggo-ocr-case-ochre.vercel.app', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];
    if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
        allowedOrigins.push(frontendUrl);
    }
    console.log('[Backend] Effective allowed origins for CORS:', allowedOrigins);

    app.enableCors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed))) {
                callback(null, true);
            } else {
                console.warn(`[Backend] CORS: Blocked origin - ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true, // Important for sending cookies
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    });


    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }),
    );
    console.log('[Backend] Global validation pipe set.');

    cachedServer = expressApp;
    console.log('[Backend] Nest application initialized and configured.');
    return cachedServer;
}

// Export a function that Vercel can call.
// This function will return the Express app instance.
export default async (req: Request, res: Response) => {
    const server = await bootstrap();
    server(req, res);
};

async function localDevelopment() {
    console.log('[Backend] main.ts execution started for local development');
    const server = await bootstrap(); // This is the expressApp
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`[Backend] Local development: Application is running on: http://localhost:${port}`);
        console.log(`[Backend] Try accessing http://localhost:${port}/`);
    });
}

if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test' && require.main === module) {
    localDevelopment();
}