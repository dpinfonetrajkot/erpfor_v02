import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { assistantFeedbackSchema, assistantQuestionSchema, type AssistantFeedback, type AssistantQuestion } from '@bht/shared';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from '../common/auth-user';
import { AssistantService } from './assistant.service';

/** "Ask ERP": questions in plain words, answered from the ERP data the user may see. */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('examples')
  @RequirePermission('assistant.view')
  examples(@CurrentUser() user: AuthUser) {
    return this.assistant.examples(user);
  }

  @Post('ask')
  @HttpCode(200)
  @RequirePermission('assistant.view')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  ask(@Body(new ZodValidationPipe(assistantQuestionSchema)) body: AssistantQuestion, @CurrentUser() user: AuthUser) {
    return this.assistant.ask(body, user);
  }

  @Post('feedback')
  @HttpCode(200)
  @RequirePermission('assistant.view')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  feedback(@Body(new ZodValidationPipe(assistantFeedbackSchema)) body: AssistantFeedback, @CurrentUser() user: AuthUser) {
    return this.assistant.feedback(body, user);
  }
}
