import { parseExpressionAt } from 'acorn';

export function extractGoldenFunction(source, name) {
  const at = source.indexOf('function ' + name + '(');
  const node = parseExpressionAt(source, at, {ecmaVersion:'latest'});
  return source.slice(node.start, node.end);
}
