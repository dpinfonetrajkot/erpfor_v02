import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body / query with a zod schema from @bht/shared.
 * The same schema validates the form in the browser, so rules never drift apart.
 *
 *   @Body(new ZodValidationPipe(customerSchema)) body: CustomerInput
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      errors[key] ??= issue.message;
    }
    throw new BadRequestException({ message: 'Please correct the highlighted fields', errors });
  }
}
