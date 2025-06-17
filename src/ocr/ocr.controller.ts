import {
    Controller,
    Post,
    Body,
    Logger,
    BadRequestException,
    InternalServerErrorException,
    HttpException,
} from '@nestjs/common';
import { OcrService } from './ocr.service';

// expected payload structure
interface ExtractTextPayloadDto {
    blobPathname: string;
    originalFileName: string;
}

@Controller('ocr')
export class OcrController {
    private readonly logger = new Logger(OcrController.name);

    constructor(private readonly ocrService: OcrService) { }

    @Post('extract-text')
    async extractTextFromBlob(
        @Body() payload: ExtractTextPayloadDto,
    ): Promise<{ text: string }> {
        this.logger.log(
            `Received request to extract text from blob: ${payload.blobPathname} (Original: ${payload.originalFileName})`,
        );

        if (!payload || !payload.blobPathname || !payload.originalFileName) {
            this.logger.error(
                'Invalid payload for OCR extraction from blob. Missing blobPathname or originalFileName.',
            );
            throw new BadRequestException(
                'Invalid payload. Missing blobPathname or originalFileName.',
            );
        }

        try {
            const extractedText = await this.ocrService.extractTextFromBlob(
                payload.blobPathname,
                payload.originalFileName,
            );
            return { text: extractedText };
        } catch (error) {
            this.logger.error(
                `Error in OcrController while processing blob ${payload.blobPathname}: ${(error as Error).message}`,
                (error as Error).stack,
            );
            if (error instanceof HttpException) {
                throw error;
            }
            throw new InternalServerErrorException(
                'An unexpected error occurred during OCR processing.',
            );
        }
    }
}