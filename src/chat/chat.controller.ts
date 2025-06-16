import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Req,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { ChatMessageDto as SendMessageDto } from './dto/chat-message.dto';
import { AuthGuard } from '@nestjs/passport';

// Define a type for the user object attached by JwtStrategy
interface AuthenticatedUser {
    userId: string;
    email: string;
    name?: string;
}

@Controller('chat')
@UseGuards(AuthGuard('jwt')) // Apply JWT guard to the whole controller
export class ChatController {
    constructor(private readonly chatService: ChatService) { }

    @Get('list')
    async getUserChats(@Req() req: { user: AuthenticatedUser }) {
        console.log('[Backend /chat/list] User from JWT:', req.user);
        return this.chatService.getUserChats(req.user.userId);
    }

    @Post('new')
    @HttpCode(HttpStatus.CREATED)
    async createNewChat(
        @Req() req: { user: AuthenticatedUser },
        @Body() createChatDto?: CreateChatDto,
    ) {
        console.log('[Backend /chat/new] User from JWT:', req.user);
        if (!createChatDto || !createChatDto.fileName || createChatDto.extractedOcrText === undefined) {
            return this.chatService.createChat(req.user.userId, createChatDto as CreateChatDto);
        }
        return this.chatService.createChat(req.user.userId, createChatDto);
    }

    @Get(':chatId/messages')
    async getChatMessages(
        @Param('chatId') chatId: string,
        @Req() req: { user: AuthenticatedUser },
    ) {
        console.log('[Backend /chat/:chatId/messages] User from JWT:', req.user);
        return this.chatService.getChatMessages(req.user.userId, chatId);
    }

    @Post('message')
    async sendMessage(
        @Body() sendMessageDto: SendMessageDto,
        @Req() req: { user: AuthenticatedUser },
    ) {
        console.log('[Backend /chat/message] User from JWT:', req.user);
        return this.chatService.processUserMessage(
            req.user.userId,
            sendMessageDto,
        );
    }

    @Get('compiled-document/:chatId')
    async getCompiledDocument(
        @Param('chatId') chatId: string,
        @Req() req: { user: AuthenticatedUser },
    ) {
        console.log('[Backend /chat/compiled-document/:chatId] User from JWT:', req.user);
        return this.chatService.getCompiledDocumentByChatId(req.user.userId, chatId);
    }

    @Get(':chatId/download-compiled')
    async downloadCompiledDocument(
        @Param('chatId') chatId: string,
        @Req() req: { user: AuthenticatedUser },
    ) {
        console.log('[Backend /chat/:chatId/download-compiled] User from JWT:', req.user);
        const fileData = await this.chatService.prepareDataForCompiledDocumentDownload(chatId, req.user.userId);
        return fileData;
    }
}