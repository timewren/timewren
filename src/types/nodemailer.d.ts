// Nodemailer leverer ikke egne typer, og vi bruger kun et lille udsnit.
declare module "nodemailer" {
  export interface SentMessageInfo {
    messageId?: string;
    accepted?: unknown[];
    rejected?: unknown[];
  }

  export interface Transporter {
    sendMail(message: Record<string, unknown>): Promise<SentMessageInfo>;
  }

  export function createTransport(
    options: Record<string, unknown>,
  ): Transporter;

  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
