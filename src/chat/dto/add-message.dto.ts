import { IsString, IsNotEmpty, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MessageSender } from '../../../generated/prisma';

export class AddMessageDto {
    @IsNotEmpty()
    @IsString()
    @IsUUID()
    chatId: string;

    @IsNotEmpty()
    @IsString()
    content: string;

    @IsNotEmpty()
    @IsEnum(MessageSender)
    sender: MessageSender;

    @IsOptional()
    @IsString()
    extractedOcrText?: string;

    @IsOptional()
    @IsString()
    fileName?: string;
}