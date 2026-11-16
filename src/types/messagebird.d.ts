declare module "messagebird" {
  interface MessageBirdMessage {
    originator: string;
    recipients: string[];
    body: string;
  }

  interface MessageBirdClient {
    messages: {
      create: (
        params: MessageBirdMessage,
        callback: (err: Error | null, response?: unknown) => void,
      ) => void;
    };
  }

  function messagebird(apiKey: string): MessageBirdClient;
  export = messagebird;
}
