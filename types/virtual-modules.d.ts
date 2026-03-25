declare module "virtual:error-reporter-source" {
  const source: string;
  export default source;
}

declare module "virtual:error-stack-parser" {
  export function parseStack(stack: string): Array<{ file: string; line: number; col: number }>;
}
