import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { roleSchema, type RoleInput } from '@bht/shared';
import { CurrentActor, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../common/auth-user';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Users need the role list for the user form, so users.view is enough too. */
  @Get()
  @RequirePermission('roles.view', 'users.view')
  list() {
    return this.roles.list();
  }

  @Get(':id')
  @RequirePermission('roles.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.roles.get(id);
  }

  @Post()
  @RequirePermission('roles.create')
  create(@Body(new ZodValidationPipe(roleSchema)) body: RoleInput, @CurrentActor() actor: Actor) {
    return this.roles.create(body, actor);
  }

  @Put(':id')
  @RequirePermission('roles.update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(roleSchema)) body: RoleInput,
    @CurrentActor() actor: Actor,
  ) {
    return this.roles.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('roles.delete')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentActor() actor: Actor) {
    return this.roles.remove(id, actor);
  }
}
