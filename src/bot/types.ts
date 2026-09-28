export interface BotReplyButton {
  id: string;
  text: string;
}

export interface BotReplyListRow {
  id: string;
  title: string;
  description?: string;
}

export interface BotReplyListSection {
  title: string;
  rows: BotReplyListRow[];
}

export interface BotReplyList {
  buttonTitle: string;
  sections: BotReplyListSection[];
}

export interface BotReplyOptions {
  text: string;
  headerTitle?: string;
  footerText?: string;
  buttons?: BotReplyButton[];
  list?: BotReplyList;
  messages?: string[];
}

export type BotResponse = string | BotReplyOptions;

export function getResponseText(response: BotResponse): string {
  if (typeof response === 'string') return response;
  if (response.messages && response.messages.length > 0) return response.messages.join('\n\n');
  return response.text;
}

