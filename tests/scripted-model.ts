import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export interface ScriptedOptions {
  /** Replays the last scripted message forever, to model an agent that never stops. */
  repeatLast?: boolean;
  failWith?: Error;
}

export class ScriptedModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  private cursor = 0;

  constructor(
    private readonly script: readonly AIMessage[],
    private readonly options: ScriptedOptions = {},
  ) {
    super({});
  }

  _llmType(): string {
    return 'scripted';
  }

  bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    if (this.options.failWith) throw this.options.failWith;
    const index = this.options.repeatLast ? Math.min(this.cursor, this.script.length - 1) : this.cursor;
    const scripted = this.script[index];
    if (!scripted) throw new Error('Scripted model ran out of messages.');
    const message = new AIMessage({
      content: scripted.content,
      tool_calls: (scripted.tool_calls ?? []).map((call) => ({ ...call, id: `${call.id}-${this.cursor}` })),
      ...(scripted.usage_metadata ? { usage_metadata: scripted.usage_metadata } : {}),
    });
    this.cursor += 1;
    return { generations: [{ text: String(message.content), message }] };
  }

  get calls(): number {
    return this.cursor;
  }
}

export const toolCall = (id: string, name: string, args: Record<string, unknown>, tokens = 10): AIMessage =>
  new AIMessage({
    content: '',
    tool_calls: [{ id, name, args, type: 'tool_call' }],
    usage_metadata: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens },
  });

export const finalAnswer = (text: string, tokens = 10): AIMessage =>
  new AIMessage({
    content: text,
    usage_metadata: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens },
  });
