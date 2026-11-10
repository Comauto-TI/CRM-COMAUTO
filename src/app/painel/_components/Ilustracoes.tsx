/** Ilustrações leves em SVG inline (sem imagens externas), nas cores do tema. */

export function IlustracaoLogin() {
  return (
    <svg viewBox="0 0 420 300" role="img" aria-label="Carro com balão de conversa e agenda confirmada" className="ilustracao">
      <defs>
        <linearGradient id="il-ceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e8f3ff" /><stop offset="1" stopColor="#f7fbff" /></linearGradient>
        <linearGradient id="il-carro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1a5ce6" /><stop offset="1" stopColor="#001e50" /></linearGradient>
        <linearGradient id="il-ciano" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#00b0f0" /><stop offset="1" stopColor="#5fd4ff" /></linearGradient>
      </defs>
      <rect x="10" y="20" width="400" height="250" rx="28" fill="url(#il-ceu)" />
      <circle cx="340" cy="70" r="26" fill="#fff" opacity=".9" />
      <path d="M30 222h360" stroke="#cfdcef" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 236h40M140 236h40M220 236h40M300 236h40" stroke="#dbe5f3" strokeWidth="3" strokeLinecap="round" />
      {/* carro */}
      <g className="il-carro">
        <path d="M78 196c0-14 8-22 22-25l34-8 30-26c6-5 13-7 21-7h62c9 0 17 4 23 10l26 27 30 6c12 2 20 11 20 23v12c0 5-4 9-9 9H87c-5 0-9-4-9-9z" fill="url(#il-carro)" />
        <path d="M176 164l22-20c4-3 8-5 13-5h22v25zM245 139h20c6 0 11 2 15 6l19 19h-54z" fill="#cfe6ff" opacity=".95" />
        <path d="M96 186h22" stroke="#00b0f0" strokeWidth="5" strokeLinecap="round" />
        <path d="M322 186h14" stroke="#ffd166" strokeWidth="5" strokeLinecap="round" />
        <circle cx="140" cy="212" r="22" fill="#0b1b3f" /><circle cx="140" cy="212" r="9" fill="#cfdcef" />
        <circle cx="296" cy="212" r="22" fill="#0b1b3f" /><circle cx="296" cy="212" r="9" fill="#cfdcef" />
      </g>
      {/* balão de conversa */}
      <g className="il-balao">
        <rect x="236" y="44" width="122" height="62" rx="16" fill="#fff" stroke="#dbe5f3" />
        <path d="M262 106l-6 16 20-16z" fill="#fff" stroke="#dbe5f3" />
        <rect x="252" y="60" width="78" height="8" rx="4" fill="#0040c5" opacity=".85" />
        <rect x="252" y="76" width="56" height="8" rx="4" fill="url(#il-ciano)" />
        <circle cx="338" cy="80" r="9" fill="#25d366" /><path d="m334 80 3 3 5-6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* agenda */}
      <g className="il-agenda">
        <rect x="46" y="48" width="96" height="86" rx="14" fill="#fff" stroke="#dbe5f3" />
        <rect x="46" y="48" width="96" height="24" rx="12" fill="#0040c5" />
        <rect x="46" y="62" width="96" height="10" fill="#0040c5" />
        {[0, 1, 2].map((l) => [0, 1, 2, 3].map((c) => (
          <rect key={`${l}-${c}`} x={58 + c * 20} y={82 + l * 16} width="12" height="9" rx="3" fill={l === 1 && c === 2 ? "#00b0f0" : "#e6eefa"} />
        )))}
      </g>
    </svg>
  );
}

export function IlustracaoVazio() {
  return (
    <svg viewBox="0 0 160 110" width="150" height="104" aria-hidden="true" className="ilustracao-vazio">
      <ellipse cx="80" cy="98" rx="56" ry="6" fill="#e6eefa" />
      <rect x="34" y="18" width="92" height="70" rx="14" fill="#fff" stroke="#dbe5f3" strokeWidth="2" />
      <rect x="48" y="34" width="50" height="7" rx="3.5" fill="#cfdcef" />
      <rect x="48" y="48" width="64" height="7" rx="3.5" fill="#e6eefa" />
      <rect x="48" y="62" width="38" height="7" rx="3.5" fill="#e6eefa" />
      <circle cx="120" cy="24" r="14" fill="#00b0f0" /><path d="m114 24 4 4 8-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
