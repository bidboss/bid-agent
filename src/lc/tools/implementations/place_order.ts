import { z } from 'zod';

/**
 * 工具3：创建外卖订单
 * 模拟：生成订单号，返回下单结果
 */
const schema = z.object({
  shop_name: z.string().describe('商家名称'),
  dish_name: z.string().describe('菜品名称'),
  quantity: z.number().int().positive().optional().default(1).describe('份数'),
  address: z.string().describe('配送地址'),
  remark: z.string().optional().describe('备注，如"少辣、加蛋"'),
});

async function execute(args: z.infer<typeof schema>) {
  const { shop_name, dish_name, quantity = 1, address, remark } = args;

  // 模拟订单生成
  const orderId = `ORD${Date.now().toString().slice(-8)}`;
  const estimatedTime = Math.floor(Math.random() * 20) + 30; // 30-50分钟

  const remarkText = remark ? `\n备注：${remark}` : '';
  const quantityText = quantity > 1 ? ` x${quantity}` : '';

  return {
    success: true,
    content: `✅ 订单创建成功！
订单号：${orderId}
商家：${shop_name}
商品：${dish_name}${quantityText}
配送地址：${address}
预计送达：约${estimatedTime}分钟
${remarkText}

请将订单号告知用户，并提醒：订单已提交，骑手即将取餐。`,
  };
}

export default { name: 'place_order', description: '创建外卖订单，确认下单后返回订单号和预计送达时间', schema, execute };
