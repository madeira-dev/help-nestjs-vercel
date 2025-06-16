import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';
import passport from 'passport';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Request, Response, Express as ExpressType } from 'express';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';

let cachedServer: ExpressType;

async function bootstrap() {
    if (cachedServer) {
        console.log('[Backend] Using cached server instance.');
        return cachedServer;
    }
    console.log('[Backend] Creating new server instance.');

    const expressApp = express();
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

    // --- Session Store Configuration (PostgreSQL) ---
    const PgSessionStore = connectPgSimple(session);
    const pool = new Pool({
        connectionString: process.env.DATABASE_ANY_CLIENT_CONNECTION_URL, // Ensure DATABASE_URL is set
        // You can add more pool options here if needed, e.g., ssl for production
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', (err) => {
        console.error('[Backend] PostgreSQL Pool Error (for sessions):', err.message);
    });
    pool.on('connect', () => {
        console.log('[Backend] Successfully connected to PostgreSQL for session store.');
    });
    console.log('[Backend] PostgreSQL session store configured.');

    // --- Session Middleware ---
    app.use(
        session({
            store: new PgSessionStore({
                pool: pool,
                tableName: 'user_sessions', // You can customize the table name
                createTableIfMissing: true, // Creates the table if it doesn't exist
                ttl: 24 * 60 * 60, // 1 day in seconds
            }),
            secret: process.env.SESSION_SECRET || 'a_very_secure_default_secret_for_dev_only_change_me',
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 24 * 60 * 60 * 1000, // 1 day in milliseconds
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            },
        }),
    );
    console.log('[Backend] Session middleware configured with PostgreSQL store.');

    // --- Passport Middleware (after session) ---
    app.use(passport.initialize());
    app.use(passport.session());
    console.log('[Backend] Passport initialized.');

    // --- CORS Configuration ---
    const frontendUrl = process.env.FRONTEND_URL;
    console.log(`[Backend] Configuring CORS. FRONTEND_URL from env: ${frontendUrl}`);
    const allowedOrigins = ['https://paggo-ocr-case-ochre.vercel.app', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];
    if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
        allowedOrigins.push(frontendUrl); // Add if not already present
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
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
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

// Export a function that Vercel can call.
export default async (req: Request, res: Response) => {
    const server = await bootstrap();
    server(req, res); // Handle the request with the Express app
};

// --- Local Development Setup ---
async function localDevelopment() {
    console.log('[Backend] main.ts execution started for local development');
    const server = await bootstrap(); // This is the expressApp
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`[Backend] Local development: Application is running on: http://localhost:${port}`);
        console.log(`[Backend] Try accessing http://localhost:${port}/`);
    });
}

// Run local development server if not in Vercel, not in test, and this file is the main module
if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test' && require.main === module) {
    localDevelopment().catch(err => {
        console.error('[Backend] Error during local development startup:', err);
        process.exit(1);
    });
}