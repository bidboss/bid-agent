// 知识库检索命中结果类型

export interface KbHit {
  text: string;
  path: string;
  score: number;// 相似度距离
}
