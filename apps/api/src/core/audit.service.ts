import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import type { Actor } from '../common/auth-user';
import { toPlain } from '../common/serialize.interceptor';

interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | number | null;
  summary?: string;
  changes?: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records who did what. Pass `tx` to write inside the same transaction as the change.
   * An audit failure never breaks the user's action outside a transaction.
   */
  async log(actor: Actor | null, entry: AuditEntry, tx?: Tx): Promise<void> {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      userId: actor?.userId ?? null,
      ip: actor?.ip ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      summary: entry.summary?.slice(0, 255),
      changes: entry.changes === undefined ? undefined : (toPlain(entry.changes) as Prisma.InputJsonValue),
    };
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    try {
      await this.prisma.auditLog.create({ data });
    } catch (err) {
      this.logger.error(`Audit log failed: ${(err as Error).message}`);
    }
  }
}
