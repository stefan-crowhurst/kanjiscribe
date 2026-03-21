export function KanjiIcon({ literal, className }: { literal: string; className?: string }) {
  return (
    <svg className={`kanji-icon ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="kanji-icon-glyph">
        {literal}
      </text>
    </svg>
  );
}
