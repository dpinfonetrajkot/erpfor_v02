import { Module } from '@nestjs/common';
import { ChatController, NotificationsController } from './communication.controller';
import { ChatService } from './chat.service';

/** Chat between colleagues and the notification bell (live over the /events connection). */
@Module({
  controllers: [ChatController, NotificationsController],
  providers: [ChatService],
})
export class CommunicationModule {}
