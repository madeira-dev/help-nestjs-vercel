import { Injectable, Logger, UnauthorizedException, ConflictException, InternalServerErrorException } from '@nestjs/common'; // Add Logger
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import * as bcrypt from 'bcrypt';
import { User } from '../../generated/prisma';

@Injectable()
export class AuthService {
    public readonly logger = new Logger(AuthService.name); // Make it public or provide a public log method

    constructor(private readonly prisma: PrismaService) { }

    async createUser(createUserDto: CreateUserDto): Promise<Omit<User, 'password'>> {
        const { email, password, name } = createUserDto;
        this.logger.log(`Attempting to sign up user: ${createUserDto.email}`);

        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new ConflictException('User with this email already exists');
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        try {
            const user = await this.prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name,
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { password: _, ...result } = user; // Exclude password from the returned object
            return result;
        } catch (error) {
            // Log the detailed error for server-side debugging
            console.error('[AuthService createUser] Error creating user:', error);
            // Provide a generic error message to the client
            throw new InternalServerErrorException('Could not create user. Please try again later.');
        }
    }

    async validateUserCredentials(loginUserDto: LoginUserDto): Promise<User | null> {
        const { email, password } = loginUserDto;
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (user && (await bcrypt.compare(password, user.password))) {
            return user;
        }
        return null;
    }
}