import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { listQuerySchema } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { paginated } from '../common/list';

const auditQuerySchema = listQuerySchema.extend({
  entity: z.string().max(50).optional(),
  entityId: z.string().max(50).optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z.enum(AuditAction).optional(),
});
type AuditQuery = z.infer<typeof auditQuerySchema>;

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit_log.view')
  async list(@Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery) {
    const where = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.search ? { summary: { contains: query.search } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, username: true, name: true } } },
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(data, total, query);
  }
}
