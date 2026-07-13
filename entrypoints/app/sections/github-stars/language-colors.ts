/**
 * GitHub linguist identity colors for common languages — data constants
 * (mode-invariant brand/identity values, like the flagpack SVG colors), NOT
 * theme colors. Unknown languages fall back to a neutral grey that stays
 * legible in both light and dark schemes.
 */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178C6',
  JavaScript: '#F1E05A',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#DEA584',
  Java: '#B07219',
  C: '#555555',
  'C++': '#F34B7D',
  'C#': '#178600',
  HTML: '#E34C26',
  CSS: '#663399',
  Shell: '#89E051',
  Vue: '#41B883',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Dart: '#00B4AB',
};

const FALLBACK_LANGUAGE_COLOR = '#9E9E9E';

export function languageColor(language: string): string {
  return LANGUAGE_COLORS[language] ?? FALLBACK_LANGUAGE_COLOR;
}
