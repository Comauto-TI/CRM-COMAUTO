/** Esqueleto instantâneo ao trocar de página (o Next mostra isso enquanto o servidor busca os dados). */
export default function Carregando() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="esqueleto" style={{ width: 220, height: 26, marginBottom: 8 }} />
      <div className="esqueleto" style={{ width: 340, height: 14, marginBottom: 24 }} />
      <div className="grade g4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card"><div className="esqueleto" style={{ width: "60%", height: 12 }} /><div className="esqueleto" style={{ width: "40%", height: 28, marginTop: 12 }} /></div>
        ))}
      </div>
      <div className="card secao">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="esqueleto" style={{ height: 16, margin: "12px 0", width: `${92 - i * 6}%` }} />)}
      </div>
    </div>
  );
}
