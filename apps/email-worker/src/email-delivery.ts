export type EmailAttachment = {
  content: Buffer;
  contentId: string;
  contentType: string;
  filename: string;
};

export type EmailMessage = {
  attachments: EmailAttachment[];
  html: string;
  subject: string;
  to: string;
};

export type ClaimedDelivery = {
  attempts: number;
  id: string;
  type: 'REGISTRATION_TICKET' | 'STAFF_INVITATION' | 'PASSWORD_RESET';
};

export interface EmailDeliveryRepository {
  claimNext(maxAttempts: number): Promise<ClaimedDelivery | undefined>;
  markFailed(
    delivery: ClaimedDelivery,
    errorCode: string,
    maxAttempts: number,
  ): Promise<void>;
  markSent(deliveryId: string, providerMessageId: string): Promise<void>;
}

export interface EmailMessageFactory {
  create(delivery: ClaimedDelivery): Promise<EmailMessage>;
}

export interface EmailTransport {
  send(message: EmailMessage, idempotencyKey: string): Promise<string>;
}

export class EmailDeliveryProcessor {
  public constructor(
    private readonly repository: EmailDeliveryRepository,
    private readonly messages: EmailMessageFactory,
    private readonly transport: EmailTransport,
    private readonly maxAttempts: number,
  ) {}

  public async processOne(): Promise<boolean> {
    const delivery = await this.repository.claimNext(this.maxAttempts);
    if (!delivery) return false;

    try {
      const message = await this.messages.create(delivery);
      const providerMessageId = await this.transport.send(message, delivery.id);
      await this.repository.markSent(delivery.id, providerMessageId);
    } catch (error) {
      await this.repository.markFailed(
        delivery,
        errorCode(error),
        this.maxAttempts,
      );
    }
    return true;
  }
}

const errorCode = (error: unknown): string => {
  if (error instanceof Error && error.name) return error.name.slice(0, 255);
  return 'EMAIL_DELIVERY_ERROR';
};
