type IconProps = { className?: string };

/**
 * ブランドマーク: ブラウザウィンドウの中にスピードメーター。
 * 「サイトの状態を計る」を 1 つの形にしたもの。
 *
 * currentColor ではなく 2 色を直接持つ（ロゴのため）。ネイビーは --color-brand と
 * 同じ値、ティールはロゴ専用（明るすぎて文字色には使えない）。
 * src/app/icon.svg は同じ形を単独ファイルにした写し（favicon / PWA 用）。
 * 両方を同時に更新すること。
 */
export function LogoMark({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" stroke="#1b3a63" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="13" width="48" height="38" rx="6" />
        <path d="M8 23h48" />
      </g>
      <g fill="none" stroke="#1b3a63" strokeWidth="1.9">
        <circle cx="15.2" cy="18" r="2.2" />
        <circle cx="22.2" cy="18" r="2.2" />
        <circle cx="29.2" cy="18" r="2.2" />
      </g>
      <g fill="none" strokeWidth="3.2" strokeLinecap="round">
        <path d="M18 44A14 14 0 0 1 32 30" stroke="#1b3a63" />
        <path d="M32 30a14 14 0 0 1 14 14" stroke="#2bcfa2" />
      </g>
      <g fill="none" stroke="#1b3a63" strokeWidth="3.2" strokeLinecap="round">
        <path d="m33.7 41.3 6.8-6.8" />
        <circle cx="31" cy="44" r="3.2" />
      </g>
    </svg>
  );
}
