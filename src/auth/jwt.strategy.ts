import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
    email: string;
    sub: string; // User ID
    name?: string;
    // Add any other fields you put into the JWT payload
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private readonly prisma: PrismaService, // Or your UserService
        private readonly configService: ConfigService,
    ) {
        const jwtSecret = configService.get<string>('JWT_SECRET');
        if (!jwtSecret) {
            // This will prevent the application from starting if the secret is missing
            throw new InternalServerErrorException('JWT_SECRET environment variable is not set.');
        }
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: jwtSecret, // Now jwtSecret is guaranteed to be a string
        });
    }

    async validate(payload: JwtPayload) {
        if (!payload || !payload.sub || !payload.email) {
            throw new UnauthorizedException('Invalid token payload');
        }
        console.log('[JwtStrategy] Token validated successfully for user:', payload.email);
        return { userId: payload.sub, email: payload.email, name: payload.name }; // This becomes req.user
    }
}