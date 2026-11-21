import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { processStageSchema, type ProcessStageInput } from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

const stageInclude = { roles: { select: { role: { select: { id: true, name: true } } } } } as const;

type StageRow = { roles: { role: { id: number; name: string } }[] } & Record<string, unknown>;

/** Production / inspection stages that every route card goes through, in order. */
@Controller('process-stages')
export class ProcessStagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('process_stages.view', 'route_cards.view')
  async list() {
    const stages = await this.prisma.processStage.findMany({ orderBy: { sequence: 'asc' }, include: stageInclude });
    return stages.map(toDto);
  }

  @Post()
  @RequirePermission('process_stages.create')
  async create(
    @Body(new ZodValidationPipe(processStageSchema)) body: ProcessStageInput,
    @CurrentActor() actor: Actor,
  ) {
    const { roleIds, ...fields } = body;
    const stage = await this.prisma.processStage.create({
      data: { ...normalize(fields), roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      include: stageInclude,
    });
    await this.audit.log(actor, {
      action: AuditAction.CREATE,
      entity: 'process_stage',
      entityId: stage.id,
      summary: `Created process stage ${stage.name}`,
    });
    return toDto(stage);
  }

  @Put(':id')
  @RequirePermission('process_stages.update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(processStageSchema)) body: ProcessStageInput,
    @CurrentActor() actor: Actor,
  ) {
    const { roleIds, ...fields } = body;
    const before = await this.prisma.processStage.findUniqueOrThrow({ where: { id }, include: stageInclude });
    const stage = await this.prisma.$transaction(async (tx) => {
      await tx.processStageRole.deleteMany({ where: { stageId: id } });
      return tx.processStage.update({
        where: { id },
        data: { ...normalize(fields), roles: { create: roleIds.map((roleId) => ({ roleId })) } },
        include: stageInclude,
      });
    });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'process_stage',
      entityId: id,
      summary: `Updated process stage ${stage.name}`,
      changes: diff(toDto(before), toDto(stage)),
    });
    return toDto(stage);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('process_stages.delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const stage = await this.prisma.processStage.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'process_stage',
      entityId: id,
      summary: `Deleted process stage ${stage.name}`,
    });
  }
}

function toDto<T extends StageRow>(stage: T) {
  const { roles, ...rest } = stage;
  return { ...rest, roles: roles.map((r) => r.role), roleIds: roles.map((r) => r.role.id) };
}
