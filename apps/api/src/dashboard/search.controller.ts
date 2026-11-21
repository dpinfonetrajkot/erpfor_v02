import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { SearchService, type SearchHit } from './search.service';

/** Ctrl+K "search everything" (any logged-in user; each kind of record follows its own permission). */
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(@CurrentUser() user: AuthUser, @Query('q') q?: string): Promise<{ hits: SearchHit[] }> {
    return { hits: await this.searchService.search(user, q) };
  }
}
