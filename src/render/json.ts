export function renderJson(model: unknown): string {
  return `${JSON.stringify(model, null, 2)}\n`;
}
