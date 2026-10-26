function cnpjValido(raiz8: string, ordem = "0001"): string {
  const base = raiz8 + ordem;
  const calc = (d: number[]) => {
    let soma = 0; let peso = d.length - 7;
    for (const dig of d) { soma += dig * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11; return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base.split("").map(Number));
  const d2 = calc((base + String(d1)).split("").map(Number));
  return base + String(d1) + String(d2);
}
console.log(cnpjValido("99990001"), cnpjValido("99990002"), cnpjValido("99990003"));
