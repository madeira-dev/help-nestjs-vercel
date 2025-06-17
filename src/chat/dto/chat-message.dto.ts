import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class ChatMessageDto {
    @IsOptional() // if not provided, a new chat might be initiated
    @IsString()
    @IsNotEmpty()
    chatId?: string;

    @IsString()
    @IsNotEmpty()
    message: string; // user's typed message

    @IsOptional()
    @IsString()
    extractedOcrText?: string; // text extracted by OCR

    @IsOptional()
    @IsString()
    fileName?: string; // should be the Vercel Blob pathname/URL

    @IsOptional()
    @IsString()
    originalUserFileName?: string; // original name of the file uploaded by the user
}