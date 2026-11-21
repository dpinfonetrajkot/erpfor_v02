import { Module } from '@nestjs/common';
import { CompletionsController, MaterialRequestsController, RouteCardsController } from './production.controller';
import { CompletionsService } from './completions.service';
import { MaterialService } from './material.service';
import { RouteCardsService } from './route-cards.service';

@Module({
  controllers: [RouteCardsController, MaterialRequestsController, CompletionsController],
  providers: [RouteCardsService, MaterialService, CompletionsService],
})
export class ProductionModule {}
