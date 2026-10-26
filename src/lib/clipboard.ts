/**
 * Copiar texto em QUALQUER contexto: HTTPS e HTTP.
 * O preview do produto roda em contexto não-seguro, onde
 * navigator.clipboard é undefined — sem o fallback os botões
 * "Copiar" falham em silêncio. Aqui: Clipboard API primeiro,
 * textarea escondida + execCommand depois, boolean sempre.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // 1) Clipboard API (precisa de contexto seguro: HTTPS / localhost)
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permissão negada ou API falhou — cai no fallback
  }

  // 2) Fallback universal: textarea fora da tela + execCommand("copy")
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
