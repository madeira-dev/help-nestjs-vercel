import { ApiProperty } from '@nestjs/swagger';

export class DocumentItemDto {
    @ApiProperty()
    documentId: string; // message ID

    @ApiProperty()
    chatId: string;

    @ApiProperty()
    fileName: string;

    @ApiProperty()
    uploadDate: Date;

    @ApiProperty({ nullable: true })
    chatTitle: string | null;
}