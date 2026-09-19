declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';
  export function markedTerminal(options?: {
    code?: string;
    heading?: string;
    firstHeading?: string;
    strong?: string;
    em?: string;
    blockquote?: string;
    link?: string;
    href?: string;
    listItem?: string;
    [key: string]: string | undefined;
  }): MarkedExtension;
}
