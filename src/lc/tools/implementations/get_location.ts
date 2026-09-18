import { z } from 'zod';

/**
 * 工具1：获取用户位置
 * 模拟：根据用户描述推断大概城市/区域
 */
const schema = z.object({
  user_description: z.string().describe('用户对自己位置的描述，如"我在北京望京"或"广州天河区"'),
});

async function execute(args: z.infer<typeof schema>) {
  const { user_description } = args;

  // 模拟：根据描述返回位置
  const descriptions: Record<string, string> = {
    北京: '北京市朝阳区望京街道',
    上海: '上海市浦东新区陆家嘴',
    广州: '广州市天河区珠江新城',
    深圳: '深圳市南山区科技园',
  };

  for (const [city, address] of Object.entries(descriptions)) {
    if (user_description.includes(city)) {
      return {
        success: true,
        content: `当前检测到城市：${city}，地址：${address}。可配送范围：方圆5公里内商家。`,
      };
    }
  }

  return {
    success: true,
    content: `未识别到明确城市，假设配送到：上海市浦东新区（默认地址）。可配送范围：方圆5公里内商家。`,
  };
}

export default { name: 'get_location', description: '获取用户当前所在城市和地址，用于筛选附近商家', schema, execute };
