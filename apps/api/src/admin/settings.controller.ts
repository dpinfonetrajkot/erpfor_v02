import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import {
  companySchema,
  documentSeriesSchema,
  type CompanyInput,
  type DocumentSeriesInput,
} from '@bht/shared';
import { AuditAction } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { diff, normalize } from '../common/normalize';
import type { Actor } from '../common/auth-user';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ----------------------------------------------------------------- companies

  /** Any logged-in user may read the companies (printed on documents, used in dropdowns). */
  @Get('companies')
  companies() {
    return this.prisma.company.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  }

  @Post('companies')
  @RequirePermission('settings.update')
  createCompany(@Body(new ZodValidationPipe(companySchema)) body: CompanyInput, @CurrentActor() actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: normalize(body) });
      if (company.isDefault) await clearOtherDefaults(tx, company.id);
      await this.audit.log(
        actor,
        { action: AuditAction.CREATE, entity: 'company', entityId: company.id, summary: `Created company ${company.name}` },
        tx,
      );
      return company;
    });
  }

  @Put('companies/:id')
  @RequirePermission('settings.update')
  async updateCompany(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(companySchema)) body: CompanyInput,
    @CurrentActor() actor: Actor,
  ) {
    const before = await this.prisma.company.findUniqueOrThrow({ where: { id } });
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.update({ where: { id }, data: normalize(body) });
      if (company.isDefault) await clearOtherDefaults(tx, company.id);
      await this.audit.log(
        actor,
        {
          action: AuditAction.UPDATE,
          entity: 'company',
          entityId: id,
          summary: `Updated company ${company.name}`,
          changes: diff(before, company),
        },
        tx,
      );
      return company;
    });
  }

  @Delete('companies/:id')
  @HttpCode(204)
  @RequirePermission('settings.update')
  async removeCompany(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    const company = await this.prisma.company.delete({ where: { id } });
    await this.audit.log(actor, {
      action: AuditAction.DELETE,
      entity: 'company',
      entityId: id,
      summary: `Deleted company ${company.name}`,
      changes: company,
    });
  }

  // ----------------------------------------------------------- document series

  @Get('document-series')
  @RequirePermission('settings.view')
  async documentSeries() {
    const series = await this.prisma.documentSeries.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(
      series.map(async (s) => ({ ...s, nextNumber: await this.numbering.preview(s.code) })),
    );
  }

  @Put('document-series/:code')
  @RequirePermission('settings.update')
  async updateDocumentSeries(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(documentSeriesSchema)) body: DocumentSeriesInput,
    @CurrentActor() actor: Actor,
  ) {
    const before = await this.prisma.documentSeries.findUniqueOrThrow({ where: { code } });
    const series = await this.prisma.documentSeries.update({ where: { code }, data: body });
    await this.audit.log(actor, {
      action: AuditAction.UPDATE,
      entity: 'document_series',
      entityId: code,
      summary: `Changed ${series.name} number format`,
      changes: diff(before, series),
    });
    return { ...series, nextNumber: await this.numbering.preview(code) };
  }
}

/** Only one company can be the default. */
function clearOtherDefaults(tx: Tx, keepId: number) {
  return tx.company.updateMany({ where: { id: { not: keepId }, isDefault: true }, data: { isDefault: false } });
}
