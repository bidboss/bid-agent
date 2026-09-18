多模态 HumanMessage 结构：`content` 不再是单纯字符串，而是**内容数组**，数组里面可以是文本类型、图片类型对象。

多模态（文本 + 图片）content 是数组：

```
new HumanMessage({
  content: [
    { type: "text", text: "描述这张图片" },
    {
      type: "image_url",
      image_url: { url: "base64图片 / 图片网络地址" }
    }
  ]
})
```

## 消息类型的参数

各消息类型的参数类型（字符串，content数组）

| 消息类型 | 是否支持简写字符串 | content 支持多模态数组 | 独有必填字段 |
| --- | --- | --- | --- |
| HumanMessage | ✅ | ✅ string / 内容数组 | 无 |
| AIMessage | ✅ | ✅ string / 内容数组 | `tool_calls`（可选，工具调用场景才需要） |
| SystemMessage | ✅ | ⚠️ 大部分模型不支持图片 | 无 |
| ToolMessage | ❌ 不能简写 | ❌ 只用字符串 | `tool_call_id`（强制必填） |

## 角色

`HumanMessage` / `AIMessage` / `SystemMessage` / `ToolMessage` 这些类**内部已经自带固定 role**，实例化的时候不用你手动指定。

## 内置 role 映射（LangChain 内部，转成 OpenAI 请求时自动映射）

表格

| LangChain 消息类 | 内部标识 | 转成 OpenAI API payload 时自动变成的 role |
| --- | --- | --- |
| `HumanMessage` | `type: "human"` | `role: "user"` |
| `AIMessage` | `type: "ai"` | `role: "assistant"` |
| `SystemMessage` | `type: "system"` | `role: "system"` |
| `ToolMessage` | `type: "tool"` | `role: "tool"` |

> 
> 注意区分两个概念：
> 
> 
> 1. **message.type**：LangChain 实例上的属性，`human` / `ai` / `system` / `tool`
> 2. **OpenAI API 的 role**：`user` / `assistant` / `system` / `tool`
> 
> 
> LangChain 的 `ChatOpenAI` 在调用模型接口时，**自动把消息实例翻译成符合 OpenAI 协议的 role 结构**，这一步你完全不用管。

写的 `buildHumanMessage`、`buildAIMessage` 这些函数**不用增加 role 参数**。
只需要构造 `content`、`tool_call_id`（ToolMessage）、`tool_calls`（AIMessage）即可。

1. LangChain **序列化消息**（`.toJSON()`）或者底层转成 OpenAI 请求体，才会生成 `role: "user"`，**是框架自动生成，不是你输入**
2. 如果你**不使用 LangChain 消息类，手写原生 OpenAI 请求对象**，这时才需要手动写 `role:"user"`

## addtional_kwargs

**kwargs = `key word arguments`**，中文：**关键字参数**

`additional_kwargs`：LangChain 消息对象上，用来存放**不属于标准消息字段、模型返回的额外附属信息**的地方。

### **AIMessage 中的 addtional_kwargs**

模型返回的其它杂项原始字段，LangChain 不解析，原样保存
> 接收模型返回消息时，用来承载模型附带的额外信息。

### **HumanMessage 中的 addtional_kwargs**

> 是你主动写入，用来传递**给模型 API 的额外参数**
当 `ChatOpenAI` 把消息序列化成 OpenAI 兼容请求体的时候，**会把 `additional_kwargs` 里面的键值对平铺合并进这条消息对象**。
绝大多数普通对话场景，HumanMessage 完全不需要填 additional_kwargs，留空即可

总结：addtional_kwargs 就是模型 和 用户之间的透传的一些信息，不在标准字段的一些信息放在里面，langchain 不会处理，直接透传。
