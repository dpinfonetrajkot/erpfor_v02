import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { listQuerySchema, toolSchema, type ListQuery, type ToolInput } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { listArgs, paginated } from '../common/list';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

const toolInclude = { item: { select: { id: true, code: true, name: true } } } as const;

@Controller('tools')
export class ToolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  @Get()
  @RequirePermission('tools.view')
  async list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    const args = listArgs(query, {
      searchFields: ['code', 'name', 'location', 'item.name'],
      sortable: ['code', 'name', 'type', 'status', 'purchaseDate'],
      defaultSort: { field: 'code', dir: 'asc' },
    });
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tool.findMany({ ...args, include: toolInclude }),
      this.prisma.tool.count({ where: args.where }),
    ]);
    return paginated(data, total, query);
  }

  @Post()
  @RequirePermission('tools.create')
  create(@Body(new ZodValidationPipe(toolSchema)) body: ToolInput, @CurrentActor() actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const code = body.code || (await this.numbering.next('TOOL', { tx }));
      const tool = await tx.tool.create({ data: { ...normalize(body), code }, include: toolInclude });
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'tool', entityId: tool.id, summary: `Created tool ${tool.code} ${tool.name}` },
        tx,
      );
      return tool;
    });
  }

  @Put(':id')
  @RequirePermission('tools.update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(toolSchema)) body: ToolInput,
    @CurrentActor() actor: Actor,
  ) {
    const before = await this.prisma.tool.findUniqueOrThrow({ where: { id }, include: toolInclude });
    const tool = await this.prisma.tool.update({
      where: { id },
      data: { ...normalize(body), code: body.code || before.code },
      include: toolInclude,
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'tool',
      entityId: id,
      summary: `Updated tool ${tool.code}`,
      changes: diff(before, tool),
    });
    return tool;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('tools.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const tool = await this.prisma.tool.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'tool',
      entityId: id,
      summary: `Deleted tool ${tool.code} ${tool.name}`,
    });
  }
}
