import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import {
  listQuerySchema,
  resetPasswordSchema,
  userCreateSchema,
  userUpdateSchema,
  type ListQuery,
  type ResetPasswordInput,
  type UserCreateInput,
  type UserUpdateInput,
} from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermission('users.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermission('users.create')
  create(@Body(new ZodValidationPipe(userCreateSchema)) body: UserCreateInput, @CurrentActor() actor: Actor) {
    return this.users.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('users.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdateInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.users.update(id, body, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  @RequirePermission('users.update')
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.users.resetPassword(id, body.newPassword, body.mustChangePassword, actor);
  }

  @Post(':id/unlock')
  @RequirePermission('users.update')
  unlock(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.users.unlock(id, actor);
  }

  @Post(':id/reset-2fa')
  @RequirePermission('users.update')
  resetTwoFactor(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.users.resetTwoFactor(id, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.users.remove(id, actor);
  }
}
