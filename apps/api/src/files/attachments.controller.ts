import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { z } from 'zod';
import { hasPermission } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CurrentActor, CurrentUser } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import type { Env } from '../config/env';
import { TRACE_FILE_ENTITIES } from '../reports/traceability.service';

/** Which records can have files, and which module's permissions protect them. */
const ENTITY_MODULE: Record<string, string> = {
  customer: 'customers',
  supplier: 'suppliers',
  product: 'products',
  item: 'items',
  heat: 'heats',
  tool: 'tools',
  company: 'settings',
  purchase_order: 'purchase_orders',
  goods_receipt: 'goods_receipts',
  sales_order: 'sales_orders',
  route_card: 'route_cards',
  /** Test reports of one stage (chemical, mechanical ...). */
  route_card_operation: 'route_card_operations',
  job_work_order: 'job_work_orders',
  /** QC report of parts back from a vendor. */
  job_work_receipt: 'job_work_receipts',
};

export const ALLOWED_EXTENSIONS = [
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.dwg', '.dxf', '.step', '.stp',
];

const uploadSchema = z.object({
  entity: z.string().refine((e) => e in ENTITY_MODULE, 'Unknown entity'),
  entityId: z.coerce.number().int().positive(),
  category: z.string().trim().max(50).optional(),
});
type UploadInput = z.infer<typeof uploadSchema>;

@Controller('attachments')
export class AttachmentsController {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.root = resolve(config.get('STORAGE_DIR', { infer: true }), 'attachments');
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(uploadSchema.omit({ category: true }))) q: Omit<UploadInput, 'category'>,
    @CurrentUser() user: AuthUser,
  ) {
    this.check(user, q.entity, 'view');
    return this.prisma.attachment.findMany({
      where: { entity: q.entity, entityId: q.entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query(new ZodValidationPipe(uploadSchema)) q: UploadInput,
    @CurrentUser() user: AuthUser,
    @CurrentActor() actor: Actor,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      this.check(user, q.entity, 'update');
      const ext = extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new BadRequestException(`File type ${ext || '(none)'} is not allowed`);
      }

      const now = new Date();
      const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const storedName = `${folder}/${randomBytes(16).toString('hex')}${ext}`;
      await mkdir(join(this.root, folder), { recursive: true });
      await rename(file.path, join(this.root, storedName));

      const attachment = await this.prisma.attachment.create({
        data: {
          entity: q.entity,
          entityId: q.entityId,
          category: q.category || null,
          originalName: file.originalname.slice(0, 255),
          storedName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: user.id,
        },
      });
      await this.audit.log(actor, {
        action: AuditAction.CREATE,
        entity: 'attachment',
        entityId: attachment.id,
        summary: `Uploaded ${attachment.originalName} to ${q.entity} #${q.entityId}`,
      });
      return attachment;
    } catch (err) {
      await unlink(file.path).catch(() => undefined);
      throw err;
    }
  }

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const attachment = await this.prisma.attachment.findUniqueOrThrow({ where: { id } });
    this.check(user, attachment.entity, 'view');
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
    res.sendFile(join(this.root, attachment.storedName));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentActor() actor: Actor) {
    const attachment = await this.prisma.attachment.findUniqueOrThrow({ where: { id } });
    this.check(user, attachment.entity, 'update');
    await this.prisma.attachment.delete({ where: { id } });
    await unlink(join(this.root, attachment.storedName)).catch(() => undefined);
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'attachment',
      entityId: id,
      summary: `Deleted ${attachment.originalName} from ${attachment.entity} #${attachment.entityId}`,
    });
  }

  private check(user: AuthUser, entity: string, action: 'view' | 'update') {
    const module = ENTITY_MODULE[entity];
    // MTC and test reports are listed in a trace: whoever may trace may open them (not change them)
    const traced = action === 'view' && TRACE_FILE_ENTITIES.includes(entity) && hasPermission(user.permissions, 'traceability.view');
    if (!module || (!traced && !hasPermission(user.permissions, `${module}.${action}`))) {
      throw new ForbiddenException('You do not have permission for these files');
    }
  }
}
