// Faixa abaixo do rodapé: "site desenvolvido por Iluminado Seller" (PIV 05/11).
// Tema da Iluminado (fundo da mesa de operação à noite, âmbar e creme, mascote
// cabeça de lâmpada) e link com utm pra medir quem chega pela SM.
const LINK = "https://www.iluminadoseller.com.br/?utm_source=smconfeccoes&utm_medium=site&utm_campaign=credito_rodape"

export default function CreditoIluminado() {
  return (
    <a className="ilu" href={LINK} target="_blank" rel="noopener" aria-label="Site desenvolvido por Iluminado Seller. Conhecer a Iluminado">
      <span className="ilu-fundo" aria-hidden="true" />
      <span className="in ilu-in">
        <span className="ilu-txt">
          <small>Site desenvolvido por</small>
          <img className="ilu-logo" src="/site/iluminado/logo.png" alt="Iluminado Seller" />
          <b>Quer um site assim pra sua marca?</b>
          <span className="ilu-btn">Conhecer a Iluminado →</span>
        </span>
        <span className="ilu-masc" aria-hidden="true">
          <span className="ilu-luz" />
          <img src="/site/iluminado/mascote.webp" alt="" />
        </span>
      </span>
    </a>
  )
}
