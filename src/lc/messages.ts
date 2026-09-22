// 构造不同类型的消息
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
} from '@langchain/core/messages';

export type ImageContentItem = {
  type: "image_url";
  image_url: {
    url: string;
  };
};
export type TextContentItem = {
  type: "text";
  text: string;
};
export type ContentItem = TextContentItem | ImageContentItem;

// 用户消息
export type BuildHumanMessageOptions = {
  text?: string;
  images?: string[];
  /** 直接传入已组装好的 content block 列表（多 content 形式，绕过 text/images 默认拼装） */
  content?: ContentItem[];
};
export function buildHumanMessage(options: BuildHumanMessageOptions) {
  const { text, images = [], content } = options;
  // 显式传入 content 时直接使用（多 content block 模式）
  if (content !== undefined) {
    return new HumanMessage({ content });
  }

  if (!images || images.length === 0) {
    return new HumanMessage(text ?? "");
  }

  const contentItems: ContentItem[] = [];

  if (text) {
    contentItems.push({
      type: "text",
      text
    });
  }

  for (const imgUrl of images) {
    contentItems.push({
      type: "image_url",
      image_url: {
        url: imgUrl
      }
    });
  }

  return new HumanMessage({ content: contentItems });
}

// 助手消息
export function buildAIMessage(content: string): AIMessage {
  return new AIMessage({ content });
}

// 系统消息
export function buildSystemMessage(content: string): SystemMessage {
  return new SystemMessage({ content });
}

// 工具消息
export function buildToolMessage(toolCallId: string, content: string): ToolMessage {
  return new ToolMessage({ tool_call_id: toolCallId, content });
}

