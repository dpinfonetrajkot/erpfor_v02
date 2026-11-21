import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface MailMessage {
  to: string;
  cc?: string | null;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** Sends e-mail through the SMTP server in .env (switched off when SMTP_HOST is empty). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transport = host
      ? nodemailer.createTransport({
          host,
          port: config.get('SMTP_PORT', { infer: true }),
          secure: config.get('SMTP_SECURE', { infer: true }) === 'true',
          auth: user ? { user, pass: config.get('SMTP_PASS', { infer: true }) } : undefined,
        })
      : null;
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport) {
      throw new BadRequestException('E-mail is not set up yet. Add the SMTP settings to the API .env file.');
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        cc: message.cc || undefined,
        subject: message.subject,
        text: message.text,
        attachments: message.attachments,
      });
    } catch (err) {
      this.logger.error(`Mail to ${message.to} failed: ${(err as Error).message}`);
      throw new BadRequestException(`The e-mail could not be sent: ${(err as Error).message}`);
    }
  }
}
