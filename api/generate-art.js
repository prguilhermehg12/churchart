const RESPONSES_URL = "https://api.openai.com/v1/responses";

function buildPrompt(data, variant) {
  const church = data.church || {};
  const layers = Array.isArray(data.layers) ? data.layers : [];
  const pastorImages = Array.isArray(data.pastorImages) ? data.pastorImages : [];
  const layerText = layers.map((layer, index) => [
    `${index + 1}. ${layer.typeLabel || layer.type || "Elemento"}`,
    `Nome: ${layer.name || ""}`,
    `Substituição: ${layer.replacement || "manter função visual"}`,
    `Área: x ${Math.round(layer.x || 0)}%, y ${Math.round(layer.y || 0)}%, largura ${Math.round(layer.w || 0)}%, altura ${Math.round(layer.h || 0)}%`
  ].join(" | ")).join("\n");

  const peopleText = pastorImages.map((p, index) =>
    `Pessoa ${index + 1}: ${p.name || `Pregador ${index + 1}`}. Posição aproximada x ${Math.round(p.x || 0)}%, y ${Math.round(p.y || 0)}%, largura ${Math.round(p.w || 0)}%, altura ${Math.round(p.h || 0)}%. ${p.replacement || ""}`
  ).join("\n");

  return `
Você é o diretor de arte do ChurchArt. Gere UMA arte final profissional para igreja.

IMAGENS DE ENTRADA:
- A PRIMEIRA imagem é a ARTE DE REFERÊNCIA. Use sua linguagem visual, hierarquia, clima, distribuição e estilo como referência.
${pastorImages.length ? "- As imagens seguintes são FOTOS REAIS DOS PREGADORES. Preserve a identidade, rosto, aparência e características dessas pessoas. NÃO invente pessoas diferentes." : ""}

REGRA DA LOGO:
- NÃO desenhe, imite, reescreva nem invente logotipo.
- A logo oficial será adicionada posteriormente pelo aplicativo.
- Onde existir uma camada de logo, deixe uma área visualmente limpa para a logo.

IGREJA:
Nome: ${church.name || ""}
Endereço: ${church.address || ""}

FORMATO:
${data.format || "feed"}

MAPA SEMÂNTICO:
${layerText || "Nenhuma camada informada."}

PESSOAS:
${peopleText || "Nenhuma foto de pregador fornecida."}

INSTRUÇÃO FINAL:
${data.instruction || "Nenhuma instrução adicional."}

VARIAÇÃO:
${variant.instruction}

REGRAS:
- Peça gráfica profissional, não apenas fotografia com texto.
- Use SOMENTE textos fornecidos pelo usuário.
- Não invente datas, horários, endereço, nomes, versículos ou slogans.
- Respeite as posições aproximadas do mapa semântico.
- Preserve legibilidade, hierarquia, contraste e acabamento.
- Se houver foto real de pregador, preserve a identidade com máxima fidelidade possível.
- NÃO gere logo; apenas reserve o espaço.
`;
}

function visualContent(data, prompt) {
  const content = [{ type: "input_text", text: prompt }];
  if (typeof data.reference === "string" && data.reference.startsWith("data:image/")) {
    content.push({ type: "input_image", image_url: data.reference, detail: "high" });
  }
  const pastors = Array.isArray(data.pastorImages) ? data.pastorImages : [];
  for (const pastor of pastors.slice(0, 3)) {
    if (typeof pastor.dataUrl === "string" && pastor.dataUrl.startsWith("data:image/")) {
      content.push({ type: "input_image", image_url: pastor.dataUrl, detail: "high" });
    }
  }
  return content;
}

async function generateVariant(data, variant) {
  const size = data.format === "wide" ? "1536x1024" : "1024x1536";
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: [{ role: "user", content: visualContent(data, buildPrompt(data, variant)) }],
      tools: [{
        type: "image_generation",
        model: "gpt-image-1",
        action: "edit",
        input_fidelity: "high",
        quality: "medium",
        size,
        output_format: "png"
      }],
      tool_choice: "required"
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || `Erro da OpenAI: ${response.status}`);

  const imageCall = Array.isArray(result.output)
    ? result.output.find(item => item.type === "image_generation_call" && item.result)
    : null;

  if (!imageCall?.result) throw new Error("A OpenAI respondeu, mas não retornou a imagem gerada.");

  return { label: variant.label, dataUrl: `data:image/png;base64,${imageCall.result}` };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY não está configurada na Vercel." });

  try {
    const data = req.body || {};
    if (!data.reference) return res.status(400).json({ error: "A arte de referência não foi enviada." });

    const variants = [
      { label: "Fiel à referência", instruction: "Seja muito fiel à estrutura, hierarquia, linguagem visual, distribuição e atmosfera da referência." },
      { label: "Equilibrada", instruction: "Preserve claramente o DNA da referência, mas melhore escala, enquadramento, hierarquia e equilíbrio como um designer profissional." },
      { label: "Mais criativa", instruction: "Mantenha o DNA, conteúdo e atmosfera da referência, porém faça uma reinterpretação autoral e sofisticada com maior liberdade compositiva." }
    ];

    const images = await Promise.all(variants.map(v => generateVariant(data, v)));
    return res.status(200).json({ success: true, images });
  } catch (error) {
    console.error("ChurchArt V0.6 generation error:", error);
    return res.status(500).json({ success: false, error: error?.message || "Erro ao gerar as artes." });
  }
};
