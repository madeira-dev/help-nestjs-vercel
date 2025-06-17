import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    UnauthorizedException,
    Get,
    UseGuards,
    Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto'
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { User as UserModel } from '../../generated/prisma';

// Define a type for the user object attached by JwtStrategy
interface AuthenticatedUser {
    userId: string;
    email: string;
    name?: string;
}

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly jwtService: JwtService,
    ) { }

    @Post('signup')
    async signup(@Body() createUserDto: CreateUserDto) {
        console.log('[Backend /auth/signup] Attempting signup for:', createUserDto.email);
        try {
            const userWithoutPassword = await this.authService.createUser(createUserDto);

            console.log('[Backend /auth/signup] User created successfully:', userWithoutPassword.email);
            return userWithoutPassword;
        } catch (error) {
            console.error('[Backend /auth/signup] Signup error:', error.message);
            throw error;
        }
    }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginUserDto: LoginUserDto) {
        console.log('[Backend /auth/login] Attempting JWT login for:', loginUserDto.email);
        const fullUser = await this.authService.validateUserCredentials(loginUserDto);

        if (!fullUser) {
            console.warn('[Backend /auth/login] Invalid credentials for:', loginUserDto.email);
            throw new UnauthorizedException('Invalid credentials');
        }

        const payload = { email: fullUser.email, sub: fullUser.id, name: fullUser.name };
        const accessToken = this.jwtService.sign(payload);

        console.log(`[Backend /auth/login] User ${fullUser.email} successfully validated. JWT issued.`);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...userResult } = fullUser;
        return {
            user: userResult,
            accessToken: accessToken,
        };
    }

    @UseGuards(AuthGuard('jwt'))
    @Get('status')
    status(@Req() req: { user: AuthenticatedUser }) {
        console.log('[Backend /auth/status] User from JWT:', req.user);
        if (!req.user) {
            throw new UnauthorizedException('User not authenticated or token invalid');
        }
        return { user: req.user };
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    async logout() {
        console.log('[Backend /auth/logout] JWT logout called (client should discard token)');
        return { message: 'Logged out successfully (client should discard token)' };
    }
}