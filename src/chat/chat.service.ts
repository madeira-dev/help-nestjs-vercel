import {
    Injectable,
    Logger,
    HttpException,
    HttpStatus,
    NotFoundException,
    ForbiddenException,
    InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenaiService } from '../openai/openai.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { ChatMessageDto } from './dto/chat-message.dto';
import { CompiledDocumentDto, ChatHistoryItemDto } from './dto/compiled-document.dto';
import { DocumentItemDto } from './dto/document-item.dto';
import { Message as PrismaMessage, MessageSender, CompiledDocument as PrismaCompiledDocument, Chat as PrismaChat, Message } from '../../generated/prisma';
import { PdfGenerationService, CompiledPdfData, ChatHistoryPdfItem } from '../pdf/pdf-generation.service';
import { OcrService } from '../ocr/ocr.service';

export interface FinalPdfDownloadBundle {
    fileName: string;
    buffer: Buffer;
    contentType: 'application/pdf';
}

@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly openAiService: OpenaiService,
        private readonly pdfGenerationService: PdfGenerationService,
        private readonly ocrService: OcrService,
    ) { }

    private generateChatTitle(firstMessageContent: string): string {
        const title = firstMessageContent.substring(0, 50);
        return title.length === 50 ? `${title}...` : title;
    }

    async findOrCreateChat(
        userId: string,
        existingChatId: string | undefined,
        firstUserMessageContent?: string,
        fileNameForTitle?: string,
    ): Promise<{
        chat: Pick<PrismaChat, 'id' | 'title' | 'userId'>;
        isNewChat: boolean;
    }> {
        if (existingChatId) {
            const chat = await this.prisma.chat.findUnique({
                where: { id: existingChatId, userId: userId },
                select: { id: true, title: true, userId: true },
            });
            if (!chat) {
                this.logger.error(
                    `Chat with ID ${existingChatId} not found for user ${userId}.`,
                );
                throw new NotFoundException(
                    `Chat with ID ${existingChatId} not found.`,
                );
            }
            return { chat, isNewChat: false };
        } else {
            let title = 'New Chat';
            if (fileNameForTitle) {
                title = this.generateChatTitle(`Document: ${fileNameForTitle}`);
            } else if (firstUserMessageContent) {
                title = this.generateChatTitle(firstUserMessageContent);
            }

            const newChat = await this.prisma.chat.create({
                data: { userId, title },
                select: { id: true, title: true, userId: true },
            });
            this.logger.log(
                `Created new chat ${newChat.id} for user ${userId} with title "${newChat.title}"`,
            );
            return { chat: newChat, isNewChat: true };
        }
    }

    private async upsertCompiledDocument(
        chatId: string,
        sourceMessage: PrismaMessage, // sourceMessage should have originalUserFileName and fileName (blob path)
    ): Promise<PrismaCompiledDocument | null> {
        this.logger.log(`Attempting to upsert CompiledDocument for chat ${chatId} using source message ${sourceMessage.id}`);

        if (!sourceMessage.fileName || sourceMessage.extractedOcrText === null || sourceMessage.extractedOcrText === undefined) {
            this.logger.warn(
                `Source message ${sourceMessage.id} for chat ${chatId} lacks fileName (blob pathname) or extractedOcrText. Cannot create/update CompiledDocument.`,
            );
            return null;
        }

        const messagesForHistory = await this.prisma.message.findMany({
            where: { chatId: chatId },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                sender: true,
                content: true,
                createdAt: true,
                fileName: true, // This is the blob pathname
                originalUserFileName: true,
            },
        });

        const chatHistorySnapshot = messagesForHistory.map(msg => ({
            sender: msg.sender,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
            ...(msg.id === sourceMessage.id && msg.originalUserFileName && { isSourceDocument: true, fileName: msg.originalUserFileName }),
        }));

        try {
            const compiledDoc = await this.prisma.compiledDocument.upsert({
                where: { chatId: chatId },
                create: {
                    chatId: chatId,
                    sourceMessageId: sourceMessage.id,
                    originalFileName: sourceMessage.originalUserFileName || sourceMessage.fileName || 'Unknown Document',
                    extractedOcrText: sourceMessage.extractedOcrText,
                    chatHistoryJson: chatHistorySnapshot as any,
                    sourceFileBlobPathname: sourceMessage.fileName,
                },
                update: {
                    chatHistoryJson: chatHistorySnapshot as any,
                    updatedAt: new Date(),
                },
            });
            this.logger.log(`Successfully upserted CompiledDocument ${compiledDoc.id} for chat ${chatId}`);
            return compiledDoc;
        } catch (error) {
            this.logger.error(
                `Error upserting CompiledDocument for chat ${chatId}: ${(error as Error).message}`,
                (error as Error).stack,
            );
            return null;
        }
    }

    async processUserMessage(
        userId: string,
        chatMessageDto: ChatMessageDto,
    ): Promise<{
        chatId: string;
        chatTitle: string;
        userMessage: Message;
        botResponse: { id: string; content: string };
        isNewChat: boolean;
    }> {
        const { chatId: existingChatId, message, extractedOcrText, fileName, originalUserFileName } = chatMessageDto; // Destructure originalUserFileName
        this.logger.log(
            `Processing message for user ${userId}, existingChatId: ${existingChatId}, fileName (blob path): ${fileName}, originalUserFileName: ${originalUserFileName}, message: "${message.substring(0, 30)}..."`,
        );

        if (!existingChatId && !fileName) {
            this.logger.error('New chat initiated without a file. This should be prevented by the frontend.');
            throw new HttpException('A document is required to start a new chat.', HttpStatus.BAD_REQUEST);
        }

        const { chat, isNewChat } = await this.findOrCreateChat(
            userId,
            existingChatId,
            message,
            originalUserFileName || fileName, // Use originalUserFileName for title generation if available
        );

        const savedUserMessage = await this.prisma.message.create({
            data: {
                chatId: chat.id,
                content: message,
                sender: MessageSender.USER,
                extractedOcrText: extractedOcrText,
                fileName: fileName, // blob pathname
                originalUserFileName: originalUserFileName, // save the original user file name
            },
        });
        this.logger.log(`Saved user message ${savedUserMessage.id} (original: ${originalUserFileName}, blob: ${fileName}) for chat ${chat.id}`);

        let sourceMessageForCompiledDoc: PrismaMessage | null = null;

        if (isNewChat && savedUserMessage.fileName && savedUserMessage.extractedOcrText !== null) {
            sourceMessageForCompiledDoc = savedUserMessage;
        } else if (!isNewChat) {
            const existingCompiledDoc = await this.prisma.compiledDocument.findUnique({
                where: { chatId: chat.id },
                include: {
                    sourceMessage: true, // sourceMessage will have all its fields
                }
            });
            if (existingCompiledDoc && existingCompiledDoc.sourceMessage) {
                sourceMessageForCompiledDoc = existingCompiledDoc.sourceMessage;
            } else {
                if (savedUserMessage.fileName && savedUserMessage.extractedOcrText !== null) {
                    sourceMessageForCompiledDoc = savedUserMessage;
                } else {
                    this.logger.warn(`Cannot identify source message for CompiledDocument in existing chat ${chat.id}. Current message lacks file/OCR or no prior compiled doc.`);
                }
            }
        }

        const historyForAI = await this.prisma.message.findMany({
            where: {
                chatId: chat.id,
                id: { not: savedUserMessage.id },
            },
            orderBy: { createdAt: 'asc' },
            select: { sender: true, content: true },
        });

        const aiFormattedHistory: { role: "user" | "assistant"; content: string }[] = historyForAI.map(msg => {
            const role: "user" | "assistant" = msg.sender === MessageSender.USER ? 'user' : 'assistant';
            return {
                role: role,
                content: msg.content,
            };
        });

        let aiResponseContent: string;
        try {
            aiResponseContent = await this.openAiService.getChatCompletion(
                message, // this is the current user text message from chatMessageDto
                aiFormattedHistory,
                savedUserMessage.extractedOcrText === null ? undefined : savedUserMessage.extractedOcrText,
                savedUserMessage.fileName === null ? undefined : savedUserMessage.fileName,
            );
        } catch (error) {
            this.logger.error(`Error getting AI completion for chat ${chat.id}: ${(error as Error).message}`, (error as Error).stack);
            throw new HttpException('Failed to get response from AI.', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const savedBotMessage = await this.prisma.message.create({
            data: {
                chatId: chat.id,
                content: aiResponseContent,
                sender: MessageSender.BOT,
            },
        });
        this.logger.log(`Saved bot message ${savedBotMessage.id} for chat ${chat.id}`);

        if (sourceMessageForCompiledDoc) {
            await this.upsertCompiledDocument(chat.id, sourceMessageForCompiledDoc);
        } else {
            this.logger.warn(`No source message identified for CompiledDocument for chat ${chat.id}. Upsert skipped.`);
        }

        return {
            chatId: chat.id,
            chatTitle: chat.title ?? 'Chat',
            userMessage: savedUserMessage,
            botResponse: { id: savedBotMessage.id, content: savedBotMessage.content },
            isNewChat,
        };
    }

    async createChat(userId: string, createChatDto: CreateChatDto): Promise<PrismaChat> {
        this.logger.log(`Attempting to create chat for user ${userId} with DTO: ${JSON.stringify(createChatDto)}`);

        if (!createChatDto.fileName || createChatDto.extractedOcrText === undefined) {
            this.logger.error('CreateChatDto is missing fileName or extractedOcrText. All new chats must start with a document.');
            throw new HttpException('A document (fileName and extractedOcrText) is required to create a new chat.', HttpStatus.BAD_REQUEST);
        }

        const title = this.generateChatTitle(`Document: ${createChatDto.fileName}`);
        const newChat = await this.prisma.chat.create({
            data: {
                userId,
                title: title,
            },
        });
        this.logger.log(`Created new chat ${newChat.id} with title "${title}"`);

        const firstMessage = await this.prisma.message.create({
            data: {
                chatId: newChat.id,
                content: createChatDto.initialUserMessage || `Uploaded: ${createChatDto.fileName}`,
                sender: MessageSender.USER,
                fileName: createChatDto.fileName,
                extractedOcrText: createChatDto.extractedOcrText,
            },
        });
        this.logger.log(`Created first message ${firstMessage.id} for new chat ${newChat.id}`);

        await this.upsertCompiledDocument(newChat.id, firstMessage);

        return newChat;
    }

    async getUserChats(userId: string): Promise<Pick<PrismaChat, 'id' | 'title' | 'createdAt' | 'updatedAt'>[]> {
        this.logger.log(`Fetching chats for user ${userId}`);
        return this.prisma.chat.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, title: true, createdAt: true, updatedAt: true },
        });
    }

    async getChatMessages(userId: string, chatId: string): Promise<Message[]> {
        this.logger.log(`Fetching messages for chat ${chatId} for user ${userId}`);
        const chat = await this.prisma.chat.findUnique({
            where: { id: chatId, userId: userId },
        });

        if (!chat) {
            throw new NotFoundException(`Chat with ID ${chatId} not found or user does not have access.`);
        }

        return this.prisma.message.findMany({
            where: { chatId: chatId },
            orderBy: { createdAt: 'asc' },
        });
    }

    async getDocumentItemsForUser(userId: string): Promise<DocumentItemDto[]> {
        this.logger.log(`Fetching document items for user ${userId}`);
        const messagesWithFiles = await this.prisma.message.findMany({
            where: {
                fileName: {
                    not: null,
                },
                chat: {
                    userId: userId,
                },
            },
            select: {
                id: true,
                chatId: true,
                fileName: true,
                createdAt: true,
                chat: {
                    select: {
                        title: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return messagesWithFiles.map(msg => ({
            documentId: msg.id,
            chatId: msg.chatId,
            fileName: msg.fileName!,
            uploadDate: msg.createdAt,
            chatTitle: msg.chat?.title ?? null,
        }));
    }

    async getCompiledDocumentByChatId(userId: string, chatId: string): Promise<CompiledDocumentDto | null> {
        this.logger.log(`Fetching compiled document for chat ID: ${chatId}, user ID: ${userId}`);
        const compiledDoc = await this.prisma.compiledDocument.findUnique({
            where: { chatId: chatId },
            include: {
                chat: {
                    select: { userId: true },
                },
                sourceMessage: {
                    select: {
                        fileName: true,
                    },
                },
            },
        });

        if (!compiledDoc) {
            this.logger.warn(`Compiled document not found for chat ID: ${chatId}`);
            throw new NotFoundException('Compiled document not found.');
        }

        if (compiledDoc.chat.userId !== userId) {
            this.logger.warn(
                `User ${userId} attempted to access compiled document for chat ${chatId} belonging to another user.`,
            );
            throw new ForbiddenException('You do not have permission to access this document.');
        }

        if (!compiledDoc.sourceMessage || !compiledDoc.sourceMessage.fileName) {
            this.logger.error(`Source message or its fileName (blob pathname) is missing for compiled document ${compiledDoc.id}`);
            throw new InternalServerErrorException('Source file information is missing for the compiled document.');
        }

        const chatHistoryDto = compiledDoc.chatHistoryJson
            ? (compiledDoc.chatHistoryJson as unknown as ChatHistoryItemDto[])
            : null;


        return {
            id: compiledDoc.id,
            chatId: compiledDoc.chatId,
            sourceMessageId: compiledDoc.sourceMessageId,
            originalFileName: compiledDoc.originalFileName,
            sourceFileBlobPathname: compiledDoc.sourceMessage.fileName,
            extractedOcrText: compiledDoc.extractedOcrText,
            chatHistoryJson: chatHistoryDto,
            createdAt: compiledDoc.createdAt.toISOString(),
            updatedAt: compiledDoc.updatedAt.toISOString(),
        };
    }

    async prepareDataForCompiledDocumentDownload(chatId: string, userId: string): Promise<FinalPdfDownloadBundle> {
        this.logger.log(`Preparing compiled document PDF for download for chat ${chatId} by user ${userId}`);

        const compiledDoc = await this.prisma.compiledDocument.findUnique({
            where: { chatId: chatId },
            include: {
                chat: { select: { userId: true } },
            },
        });

        if (!compiledDoc) {
            throw new NotFoundException(`Compiled document metadata for chat ID ${chatId} not found.`);
        }

        if (compiledDoc.chat.userId !== userId) {
            throw new ForbiddenException(`User ${userId} does not have access to compiled document for chat ID ${chatId}.`);
        }

        if (!compiledDoc.sourceFileBlobPathname) {
            this.logger.warn(`Source file blob pathname is missing for compiled document ${compiledDoc.id}. Original file cannot be embedded.`);
        }

        let originalFileBuffer: Buffer | undefined = undefined;
        let originalFileType: 'pdf' | 'png' | 'jpeg' | 'unsupported' = 'unsupported';

        if (compiledDoc.sourceFileBlobPathname) {
            try {
                originalFileBuffer = await this.ocrService.fetchFileBufferFromBlob(
                    compiledDoc.sourceFileBlobPathname,
                    `embedding in compiled PDF for chat ${chatId}`,
                );
                const extension = compiledDoc.originalFileName.split('.').pop()?.toLowerCase();
                if (extension === 'pdf') originalFileType = 'pdf';
                else if (extension === 'png') originalFileType = 'png';
                else if (['jpg', 'jpeg'].includes(extension || '')) originalFileType = 'jpeg';
                else {
                    this.logger.warn(`Original file type .${extension} is unsupported for direct embedding. Path: ${compiledDoc.sourceFileBlobPathname}`);
                    originalFileType = 'unsupported';
                }
            } catch (error) {
                this.logger.error(
                    `Failed to fetch original file buffer from blob ${compiledDoc.sourceFileBlobPathname} for PDF generation: ${(error as Error).message}`,
                    (error as Error).stack,
                );
                originalFileBuffer = undefined;
                originalFileType = 'unsupported';
            }
        }

        const chatHistoryForPdf: ChatHistoryPdfItem[] | null = compiledDoc.chatHistoryJson
            ? (compiledDoc.chatHistoryJson as unknown as ChatHistoryPdfItem[])
            : null;

        const pdfInputData: CompiledPdfData = {
            originalFileName: compiledDoc.originalFileName,
            extractedOcrText: compiledDoc.extractedOcrText,
            chatHistory: chatHistoryForPdf,
            originalFileBuffer: originalFileBuffer,
            originalFileType: originalFileType,
        };

        const pdfBuffer = await this.pdfGenerationService.generateCompiledPdf(pdfInputData);

        const downloadFileName = `compiled_${compiledDoc.originalFileName.replace(/\.[^/.]+$/, "")}_${chatId.substring(0, 8)}.pdf`;

        this.logger.log(`Generated compiled PDF for download: ${downloadFileName}, Size: ${pdfBuffer.length} bytes`);

        return {
            fileName: downloadFileName,
            buffer: pdfBuffer,
            contentType: 'application/pdf',
        };
    }
}