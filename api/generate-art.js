const OPENAI_URL = "https://api.openai.com/v1/images/generations";

function buildPrompt(data) {
  const church = data.church || {};
  const layers = Array.isArray(data.layers) ? data.layers : [];

  const layerText = layers.map((layer, index) => {
    return [
      `${index + 1}. ${layer.typeLabel || layer.type || "Elemento"}`,
      `Nome: ${layer.name || ""}`,
      `Substituição solicitada: ${layer.replacement || "manter conceito visual"}`,
      `Posição na referência: x ${Math.round(layer.x || 0)}%, y ${Math.round(layer.y || 0)}%, largura ${Math.round(layer.w || 0)}%, altura ${Math.round(layer.h || 0)}%`
    ].join(" | ");
  }).join("\n");

  return `
Crie um cartaz profissional de igreja cristã evangélica.

OBJETIVO:
Produzir uma peça de design gráfico com aparência de trabalho profissional feito por designer, pronta para redes sociais ou telão de igreja.

IGREJA:
Nome: ${church.name || ""}
Endereço: ${church.address || ""}

FORMATO:
${data.format || "feed"}

ELEMENTOS IDENTIFICADOS PELO USUÁRIO:
${layerText || "Nenhum elemento especificado."}

DIREÇÃO DE ARTE ADICIONAL:
${data.instruction || "Nenhuma."}

REGRAS IMPORTANTES:
- O resultado deve parecer uma arte gráfica profissional, não uma fotografia comum.
- Crie hierarquia tipográfica forte e legível.
- Preserve espaço visual, contraste, profundidade e equilíbrio.
- Não invente informações como datas, horários, nomes ou endereços.
- Use somente os textos fornecidos pelo usuário.
- Não acrescente slogans ou frases religiosas que não tenham sido solicitadas.
- Trate títulos como elementos reais de design gráfico.
- Evite aparência genérica de template.
- Evite excesso de elementos decorativos.
- A composição deve ter qualidade compatível com publicidade profissional de igreja.
`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY não está configurada na Vercel."
    });
  }

  try {
    const data = req.body || {};
    const basePrompt = buildPrompt(data);

    const variants = [
      {
        label: "Fiel à referência",
        instruction:
          "Mantenha uma composição mais controlada e organizada, respeitando rigorosamente as posições e proporções descritas pelo mapa semântico."
      },
      {
        label: "Equilibrada",
        instruction:
          "Faça uma interpretação profissional equilibrada. Preserve a hierarquia e intenção da referência, mas melhore proporções, tipografia, profundidade e composição."
      },
      {
        label: "Mais criativa",
        instruction:
          "Faça uma interpretação mais autoral e sofisticada, mantendo todo o conteúdo correto, mas permitindo maior liberdade de composição e linguagem visual."
      }
    ];

    const size =
      data.format === "wide"
        ? "1536x1024"
        : "1024x1536";

    const requests = variants.map(async (variant) => {
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: `${basePrompt}

VARIAÇÃO DESTA PROPOSTA:
${variant.instruction}`,
          size,
          quality: "medium",
          output_format: "png"
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error?.message ||
          `Erro da OpenAI: ${response.status}`
        );
      }

      const image = result?.data?.[0]?.b64_json;

      if (!image) {
        throw new Error("A OpenAI não retornou a imagem.");
      }

      return {
        label: variant.label,
        dataUrl: `data:image/png;base64,${image}`
      };
    });

    const images = await Promise.all(requests);

    return res.status(200).json({
      success: true,
      images
    });

  } catch (error) {
    console.error("ChurchArt generation error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Erro ao gerar as artes."
    });
  }
};
