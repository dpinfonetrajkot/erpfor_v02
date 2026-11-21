import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@bht/shared';
import { Prisma } from '../generated/prisma/client';

/** Turns every error into the ApiError shape the web app expects. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') return { statusCode, message: response };
      const r = response as { message?: string | string[]; errors?: Record<string, string> };
      const message = Array.isArray(r.message) ? r.message.join(', ') : (r.message ?? exception.message);
      return { statusCode, message, ...(r.errors ? { errors: r.errors } : {}) };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          const fields = uniqueFields(exception.meta);
          return {
            statusCode: HttpStatus.CONFLICT,
            message: fields.length
              ? `A record with this ${fields.join(' + ')} already exists`
              : 'This record already exists',
            ...(fields.length === 1 ? { errors: { [fields[0]]: 'Already exists' } } : {}),
          };
        }
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            message:
              'This record is linked to other records and cannot be deleted. Mark it inactive instead.',
          };
        case 'P2025':
          return { statusCode: HttpStatus.NOT_FOUND, message: 'Record not found' };
      }
    }

    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Something went wrong. Please try again.' };
  }
}

/** Field names of the violated unique constraint (shape differs between Prisma engines). */
function uniqueFields(meta: Record<string, unknown> | undefined): string[] {
  const target = meta?.target;
  if (Array.isArray(target)) return target.map(String);
  const adapterFields = (meta?.driverAdapterError as { cause?: { constraint?: { fields?: string[] } } })
    ?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) return adapterFields.map((f) => f.replace(/`/g, ''));
  return [];
}
