import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PassportModule } from '@nestjs/passport';
import { SessionSerializer } from './session.serializer';

@Module({
    imports: [
        PassportModule.register({ session: true }), // Ensure session support is enabled
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        SessionSerializer, // Register the serializer
    ],
})
export class AuthModule { }