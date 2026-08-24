import type {
  ExcelImportMapping,
  ExcelImportPreviewResponse,
  ExcelImportCommitResponse,
} from '@event-registration/contracts';
import {
  excelImportCommitRequestSchema,
  excelImportMappingSchema,
  uuidSchema,
} from '@event-registration/contracts';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';

import { RequireRoles, RolesGuard, SessionGuard } from '../auth/auth.guards.js';
import type { StaffRequest } from '../auth/auth.types.js';
import { ApiError, parseContract } from '../common/api-error.js';
import { EXCEL_FILE_LIMIT } from './excel-parser.js';
import { ExcelService } from './excel.service.js';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('admin/events/:eventId')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN')
export class ExcelController {
  public constructor(
    @Inject(ExcelService) private readonly excel: ExcelService,
  ) {}

  @Post('import/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: EXCEL_FILE_LIMIT, files: 1 },
    }),
  )
  public preview(
    @Param('eventId') eventId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mapping') mappingJson: string | undefined,
    @Req() request: StaffRequest,
  ): Promise<ExcelImportPreviewResponse> {
    if (
      !file ||
      file.mimetype !== XLSX_MIME ||
      !file.originalname.toLowerCase().endsWith('.xlsx')
    ) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'A valid .xlsx file is required',
      );
    }
    let mapping: ExcelImportMapping | undefined;
    if (mappingJson) {
      try {
        mapping = parseContract(
          excelImportMappingSchema,
          JSON.parse(mappingJson),
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Column mapping must be valid JSON',
        );
      }
    }
    return this.excel.preview(
      parseContract(uuidSchema, eventId),
      request.auth.user.id,
      file,
      mapping,
    );
  }

  @Post('import/:importJobId/commit')
  public commit(
    @Param('eventId') eventId: string,
    @Param('importJobId') importJobId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<ExcelImportCommitResponse> {
    return this.excel.commit(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, importJobId),
      request.auth.user.id,
      parseContract(excelImportCommitRequestSchema, body),
    );
  }

  @Get('export.xlsx')
  public async export(
    @Param('eventId') eventId: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.excel.export(parseContract(uuidSchema, eventId));
    response.setHeader('Content-Type', XLSX_MIME);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(result.data);
  }
}
