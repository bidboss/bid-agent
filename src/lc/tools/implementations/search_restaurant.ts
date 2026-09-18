import { z } from 'zod';

/**
 * 工具2：搜索螺蛳粉商家
 * 模拟：根据城市和关键词返回商家列表
 */
const schema = z.object({
  city: z.string().describe('城市名，如"北京"、"广州"'),
  keyword: z.string().optional().default('螺蛳粉').describe('搜索关键词'),
  limit: z.number().int().positive().optional().default(3).describe('最多返回商家数量'),
});

async function execute(args: z.infer<typeof schema>) {
  const { city, keyword = '螺蛳粉', limit = 3 } = args;

  // 模拟商家数据库
  const shops = [
    { name: '柳州螺蛳粉（望京店）', rating: '4.8', price: '28元起送', distance: '1.2km', tags: ['正宗柳州味', '加辣加蛋'] },
    { name: '桂林米粉专家', rating: '4.6', price: '25元起送', distance: '2.1km', tags: ['酸笋多', '老字号'] },
    { name: '爆辣螺蛳粉专门店', rating: '4.9', price: '30元起送', distance: '3.5km', tags: ['特辣', '加腐竹'] },
    { name: '阿婆螺蛳粉', rating: '4.7', price: '22元起送', distance: '1.8km', tags: ['本地人推荐', '软糯'] },
  ];

  const results = shops.slice(0, limit);
  const lines = results.map(
    (s, i) =>
      `${i + 1}. 【${s.name}】⭐${s.rating} | ${s.price} | 距离${s.distance} | ${s.tags.join('、')}`
  );

  return {
    success: true,
    content: `在${city}搜索到"${keyword}"商家共${results.length}家：\n${lines.join('\n')}\n\n请告诉用户排名最靠前的商家信息，供用户选择。`,
  };
}

export default { name: 'search_restaurant', description: '根据城市和关键词搜索外卖商家，返回商家列表（含评分、起送价、距离）', schema, execute };
