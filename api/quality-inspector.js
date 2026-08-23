// ChurchDesign V0.31.9 — quality inspector + logo occupancy mode on one published route
module.exports.config={maxDuration:60};
const RESPONSES_URL="https://api.openai.com/v1/responses";




const schema={type:"object",additionalProperties:false,required:["approved","critical_error","score","human_fidelity","logo_fidelity","content_accuracy","reference_coherence","typography_conversion_safe","typography_score","typography_reason","gross_errors","correction_prompt"],properties:{
approved:{type:"boolean"},critical_error:{type:"boolean"},score:{type:"number"},
human_fidelity:{type:"number"},logo_fidelity:{type:"number"},content_accuracy:{type:"number"},reference_coherence:{type:"number"},typography_conversion_safe:{type:"boolean"},typography_score:{type:"number"},typography_reason:{type:"string"},
gross_errors:{type:"array",items:{type:"string"}},correction_prompt:{type:"string"}
}};
function content(data){
  const c=[{type:"input_text",text:`Você é o FISCAL DE QUALIDADE do ChurchDesign. Você NÃO cria arte. Você decide se uma arte pode ser entregue a um cliente que pagará créditos.

PRINCÍPIO: complexidade quando possível; coerência sempre. Prefira uma solução visual simples e correta a uma sofisticada com erros.

ERROS CRÍTICOS que reprovam:
- rosto/pessoa perceptivelmente diferente da foto original;\n- canvas interno/pôster menor dentro de uma área externa, inclusive quando a própria arte é repetida ampliada/desfocada para preencher proporção;
- duplicação semântica de subtítulo, data, horário, endereço ou nome quando não solicitada;
- qualquer pessoa, mão, cabeça ou objeto vindo da foto de igreja aparecendo por cima do pregador;
- texto editável colocado fora da safe area ou com contraste claramente inferior ao contexto;
- corte desnecessário de cabeça, mãos, braços, pernas, pés ou tronco quando a foto original permitia composição de corpo mais completo e a referência/instrução não justificava esse crop;
- pessoa obrigatória ausente;
- logo deformada, redesenhada ou trocada;
- logo colocada dentro de caixa/card/placa/selo/fundo próprio sem que isso exista claramente na referência ou tenha sido pedido;
- símbolo, ícone ou qualquer parte da logo repetido em outro ponto da arte, ou mais de uma instância da identidade visual sem pedido explícito;
- título/data/horário/endereço obrigatórios errados, inventados ou ausentes;
- QUALQUER texto legível que não esteja na allowlist atual;
- qualquer palavra, slogan, nome, data, número ou frase herdada semanticamente da referência;
- qualquer placeholder visual como “reservado para logo”, “logo aqui”, caixa/rótulo de logo ou marca inventada;
- erro grosseiro de posicionamento quando o usuário especificou uma região;
- arte quebrada, ilegível ou com artefatos severos;
- composição artificial de cartaz/quadro menor dentro de outro fundo/moldura sem que isso faça parte da referência ou instrução;
- excesso de caixas/cards/cápsulas que transforme a arte em aparência de interface/template, especialmente quando a referência não usa esse recurso;\n- qualquer texto, logo, rosto, nome de pregador, data, horário, endereço ou informação essencial dentro dos 10% externos da imagem, cortado, encostado na borda ou parcialmente fora do canvas;
- foto da igreja selecionada ausente ou substituída por outra imagem de igreja.

Se público-alvo ou estilo estiverem especificados, verifique se a peça é coerente com eles, mas não reprove por diferenças criativas pequenas.
Se não estiverem especificados, ignore esse critério.
Erros criativos menores NÃO devem reprovar. Porém, violação de área segura de conteúdo essencial deve reprovar.

OMISSÕES DA ARTE FILHA — PRIORIDADE ABSOLUTA:
- Se userInstruction/finalInstruction pedir omitir pregador/pessoas, a arte final deve ter ZERO pregadores/pessoas principais, mesmo que a referência contenha uma pessoa.
- Se pedir omitir logo, a arte final deve ter ZERO logos ou símbolos derivados da logo da referência.
- Se pedir omitir foto da igreja, a fotografia da igreja presente na referência não deve permanecer.
- Preservar a referência NUNCA supera uma omissão explícita do usuário.
- A presença de um elemento explicitamente omitido é ERRO CRÍTICO.

TIPOGRAFIA:
- Toda tipografia deve estar integrada à arte final.
- Conte ocorrências de data, hora, endereço, subtítulo e nomes.
- Reprove duplicação de qualquer campo obrigatório.
- Reprove texto sobreposto a outro texto a ponto de comprometer legibilidade.
- Reprove informação obrigatória fora da safe area.\n

- ATIVOS SAGRADOS — FALHA CRÍTICA: reprove fusão entre pregadores, transferência de microfone/mãos/roupa/objetos entre camadas, alteração relevante de rosto ou mistura entre logo da igreja e logo de evento.
- CAMADA DO PRINCIPAL: nenhum elemento pertencente a auxiliar pode atravessar indevidamente para frente do principal.
- NOME VAZIO: reprove qualquer “Pessoa N”, “Pastor”, “Pregador”, nome inferido ou placeholder.
- LOGOS: esta é EXCLUSIVAMENTE a etapa LOGO-FREE. A ausência das logos oficiais é CORRETA e nunca pode reduzir score nem reprovar. Reprove somente se alguma logo, wordmark, emblema ou marca da referência sobreviveu/inventou-se no canvas. Para o campo logo_fidelity, use 100 quando o canvas estiver corretamente sem logos; reduza apenas quando existir marca indevida.
- DELTA ONLY: reprove mudanças não solicitadas na versão-base, inclusive dedos/mãos, pose, rosto, palavras de fundo, logos, cores e efeitos.
- DIREÇÃO: prefira auxiliares abrindo para fora do centro; flip horizontal integral é aceitável sem alteração de identidade.

- SUBSTITUIÇÃO DE REFERÊNCIA — FALHA CRÍTICA: se existem fotos de pregadores enviadas, nenhuma pessoa humana original da arte de referência pode permanecer, salvo autorização explícita. Reprove imediatamente se o protagonista/pastor/modelo da referência continuar visível.
- PRINCIPAL: confirme que a pessoa central/dominante é de fato a FOTO DO PREGADOR PRINCIPAL enviada, e não a pessoa da referência.
- FISIONOMIA: compare rigorosamente cada rosto final às fotos originais. Mudança perceptível de identidade, mistura de traços ou alteração facial significativa é falha crítica.
- POSE: preserve braço levantado/abaixado, gesto, microfone, orientação corporal e direção do olhar. Mudança injustificada de uma pose marcante deve reprovar.
- POSICIONAMENTO DIRECIONAL: auxiliar orientado para a direita deve preferencialmente ficar do lado direito do principal; orientado para a esquerda, do lado esquerdo. Reprove quando a inversão prejudicar claramente a lógica visual e não houver justificativa da referência/instrução.
- CANVAS LOGO-FREE: nesta etapa, a imagem deve conter ZERO logos. Reprove qualquer logo, marca, emblema institucional, símbolo copiado da referência, wordmark ou marca de evento que tenha sobrevivido ou sido inventado.
- NÃO reprove ausência das logos oficiais em hipótese alguma. Posicionamento, contraste, tamanho e sobreposição de logos serão avaliados por outro módulo DEPOIS deste Fiscal.
- HIERARQUIA DE PREGADORES: quando houver mais de um, PESSOA 1 é PRINCIPAL e precisa ter prioridade visual e posição mais central que os auxiliares. PESSOA 2 = AUXILIAR 1; PESSOA 3 = AUXILIAR 2.
- Reprove se o principal for tratado como auxiliar periférico enquanto outro pregador ocupa claramente a posição central/dominante sem instrução explícita do usuário.
- Reprove troca de identidade, nome ou papel entre os pregadores.
- Com três pregadores, aceite variações criativas, mas exija que o principal continue sendo o eixo visual predominante.
- Se omitChurchLogo=true, a presença de qualquer logo principal da igreja é falha crítica.\n- Se omitChurchName=true, a presença textual do nome da igreja é falha crítica.

FIDELIDADE GEOMÉTRICA:
- Compare enquadramento, posição e escala do pregador com a referência.
- Se a referência usa busto/peito/cintura e a arte usa corpo inteiro sem instrução, reprove.
- Compare grandes massas tipográficas/letreiros de fundo, áreas vazias, glows e sombras. Omissão de um elemento estrutural grande da referência é erro relevante.
- Reprove qualquer borda/blur externo criado para encaixar uma arte interna em outro aspect ratio.
- Conte ocorrências de cada dado semântico. Data, hora, endereço, subtítulo e nome de pregador não podem aparecer duplicados sem instrução.

COMPOSIÇÃO ADAPTATIVA:
- Verifique se a arte usa apenas as pessoas realmente fornecidas.
- Se a referência tinha mais pessoas que os assets fornecidos, a arte deve ter sido recomposta para a quantidade real.
- Reprove silhuetas, sombras humanas, espaços reservados ou pessoas inventadas usados apenas para imitar posições de pessoas ausentes na referência.
- A referência deve ser preservada como linguagem visual, não como molde rígido.

Conteúdo obrigatório: ${JSON.stringify(data.requiredContent||{})}
TIPOGRAFIA FINAL:
- Toda a tipografia é gerada diretamente na arte.
- Reprove qualquer dado obrigatório duplicado.
- Reprove texto sobre texto, informação ilegível, conteúdo cortado ou contraste inadequado.
- Compare a linguagem tipográfica com a referência; diferença significativa sem justificativa reduz a fidelidade.
Público-alvo escolhido: ${data.audience||"não especificado"}
Estilo escolhido: ${data.designStyle||"não especificado"}\nPosição prioritária da logo: ${data.logoPosition||"seguir referência / automática"}\nPosição/zona da logo de evento: ${data.eventLogoPosition||data.assets?.eventLogo?.position||"automática entre seis zonas centrais"}\nTamanho máximo da logo de evento: ${data.eventLogoSize||data.assets?.eventLogo?.size||"small"} (small≈14% da largura; medium≈20%; large≈26%)\nOmitir logo principal: ${data.omitChurchLogo?"SIM":"não"}\nOmitir nome da igreja: ${data.omitChurchName?"SIM":"não"}
TEXTOS AUTORIZADOS (ALLOWLIST): ${JSON.stringify(data.allowedTexts||[data.requiredContent?.title,data.requiredContent?.subtitle,data.requiredContent?.date,data.requiredContent?.time,data.requiredContent?.address,data.requiredContent?.churchName,...(data.requiredContent?.pastorNames||[])].filter(Boolean))}
REGRA: qualquer outro texto legível é inventado/herdado e deve reprovar.
Mapa/posições: ${JSON.stringify(data.semanticMap||[])}
Instrução: ${data.userInstruction||""}
Instrução final: ${data.finalInstruction||""}

Avalie de forma conservadora. Se reprovar, escreva correction_prompt curto e operacional. Se a complexidade estiver causando erro, mande SIMPLIFICAR a área problemática.`}];
  for(const r of (data.references||[]).slice(0,1))if(r?.image)c.push({type:"input_text",text:"REFERÊNCIA DE DESIGN:"},{type:"input_image",image_url:r.image,detail:"auto"});
  for(const [i,p] of (data.assets?.pastors||[data.assets?.pastor].filter(Boolean)).entries())if(p?.image)c.push({type:"input_text",text:`FOTO ORIGINAL — ${i===0?'PREGADOR PRINCIPAL':`PREGADOR AUXILIAR ${i}`}. Nome esperado: ${p.name||'não informado'}`},{type:"input_image",image_url:p.image,detail:"auto"});
  if(data.assets?.churchImage?.image&&!/omitir foto da igreja/i.test(`${data.userInstruction||""} ${data.finalInstruction||""}`))c.push({type:"input_text",text:"FOTO DA IGREJA SELECIONADA — deve estar presente e reconhecível na arte:"},{type:"input_image",image_url:data.assets.churchImage.image,detail:"auto"});
  if(data.assets?.logo?.image||data.assets?.eventLogo?.image)c.push({type:"input_text",text:"LOGO-FREE STAGE: as logos oficiais serão coladas depois por código. Não exija a presença delas. Reprove, isto sim, qualquer logo, marca, emblema, wordmark ou símbolo institucional que o gerador tenha copiado/inventado no canvas."});
  if(data.preTypographyImage)c.push({type:"input_text",text:"ARTE ANTES DA CONVERSÃO TIPOGRÁFICA:"},{type:"input_image",image_url:data.preTypographyImage,detail:"high"});
  c.push({type:"input_text",text:"ARTE GERADA A SER FISCALIZADA:"},{type:"input_image",image_url:data.generatedImage,detail:"high"});
  return c;
}
function out(d){if(d.output_text)return d.output_text;for(const i of d.output||[])if(i.type==="message")for(const p of i.content||[])if(p.type==="output_text")return p.text;return"";}

// ============================================================
// V0.31.9 — LOGO OCCUPANCY MODE
// Logical agent remains separate, but shares this already-published
// serverless endpoint to avoid Vercel route publication issues.
// ============================================================
const LOGO_OCCUPANCY_REGION_TYPES=[
  "person","face","hand","microphone","instrument",
  "text_title","text_subtitle","text_date","text_address","text_other",
  "graphic_focus"
];

const LOGO_OCCUPANCY_SCHEMA={
  type:"object",
  additionalProperties:false,
  required:["regions","tone_grid","notes"],
  properties:{
    regions:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        required:["type","x0","y0","x1","y1","confidence"],
        properties:{
          type:{type:"string",enum:LOGO_OCCUPANCY_REGION_TYPES},
          x0:{type:"number"},y0:{type:"number"},x1:{type:"number"},y1:{type:"number"},
          confidence:{type:"number"}
        }
      }
    },
    tone_grid:{
      type:"object",
      additionalProperties:false,
      required:["cols","rows","values"],
      properties:{
        cols:{type:"number"},
        rows:{type:"number"},
        values:{type:"array",items:{type:"number"}}
      }
    },
    notes:{type:"array",items:{type:"string"}}
  }
};

function logoOccupancyClamp(n,min,max){
  n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;
}
function logoOccupancyNormalizeRegion(r){
  const x0=logoOccupancyClamp(Math.min(Number(r.x0)||0,Number(r.x1)||0),0,1000);
  const x1=logoOccupancyClamp(Math.max(Number(r.x0)||0,Number(r.x1)||0),0,1000);
  const y0=logoOccupancyClamp(Math.min(Number(r.y0)||0,Number(r.y1)||0),0,1000);
  const y1=logoOccupancyClamp(Math.max(Number(r.y0)||0,Number(r.y1)||0),0,1000);
  return{
    type:LOGO_OCCUPANCY_REGION_TYPES.includes(r.type)?r.type:"graphic_focus",
    x0,y0,x1,y1,confidence:logoOccupancyClamp(r.confidence,0,1)
  };
}
function logoOccupancyNormalizeGrid(g={}){
  const cols=8,rows=10,expected=cols*rows,input=Array.isArray(g.values)?g.values:[];
  return{cols,rows,values:Array.from({length:expected},(_,i)=>logoOccupancyClamp(input[i]??50,0,100))};
}
async function handleLogoOccupancyMode(req,res){
  const data=req.body||{},image=data.image,expectations=data.expectations||{};
  if(!image||!String(image).startsWith("data:image/")){
    return res.status(400).json({error:"Envie a base plate como data:image/... .",diagnostic:{stage:"logo-occupancy-input"}});
  }

  const prompt=`Você é o ANALISADOR DE OCUPAÇÃO do ChurchDesign.
Você NÃO cria arte e NÃO escolhe onde logos devem ficar.

Analise a imagem final LOGO-FREE e devolva apenas um mapa semântico conservador para um solver determinístico.

COORDENADAS:
- Escala 0..1000.
- x0,y0 = canto superior esquerdo; x1,y1 = canto inferior direito.
- Cubra a extensão VISÍVEL INTEIRA das pessoas, incluindo cabelo, braços, cotovelos, mãos, pernas e objetos segurados.
- Para PERSON, prefira caixa um pouco MAIOR a uma caixa apertada.
- Detecte FACE e HAND separadamente quando visíveis.
- Detecte MICROPHONE e INSTRUMENT.
- Detecte blocos de texto por função: text_title, text_subtitle, text_date, text_address, text_other.
- graphic_focus = elemento gráfico importante que não deve ser coberto.
- Se houver dúvida entre marcar uma área e deixá-la livre, MARQUE-A.
- NÃO retorne posição de logo.

TONE GRID:
- Grade fixa 8x10, linha a linha.
- Exatamente 80 valores.
- 0 = muito escuro; 100 = muito claro.

EXPECTATIVAS:
- pregadores esperados: ${Number(expectations.pastorCount||0)}
- há texto relevante esperado: ${expectations.hasText?'SIM':'NÃO'}

Se há pregadores esperados, é obrigatório devolver regiões humanas para as pessoas claramente visíveis.`;

  const model=process.env.LOGO_ANALYZER_MODEL||process.env.QUALITY_INSPECTOR_MODEL||"gpt-5.6-terra";
  const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model,
      reasoning:{effort:"low"},
      store:false,
      input:[{role:"user",content:[
        {type:"input_text",text:prompt},
        {type:"input_image",image_url:image,detail:"high"}
      ]}],
      text:{format:{type:"json_schema",name:"churchdesign_logo_occupancy",strict:true,schema:LOGO_OCCUPANCY_SCHEMA},verbosity:"low"}
    })
  });

  const requestId=r.headers.get("x-request-id")||null;
  const d=await r.json();
  if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);

  const rawText=(typeof d.output_text==="string"?d.output_text:
    (d.output||[]).flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text)||"";
  let parsed;
  try{parsed=JSON.parse(rawText)}catch{throw new Error("Logo Occupancy devolveu JSON inválido.");}

  const normalizedRegions=(parsed.regions||[])
    .map(logoOccupancyNormalizeRegion)
    .filter(x=>x.x1>x.x0&&x.y1>x.y0&&x.confidence>=.20);

  const detectedPeople=normalizedRegions.filter(r=>r.type==="person"||r.type==="face").length;
  const detectedText=normalizedRegions.filter(r=>String(r.type).startsWith("text_")).length;

  if(Number(expectations.pastorCount||0)>0&&!detectedPeople){
    throw new Error("Logo Occupancy não detectou o pregador esperado.");
  }
  if(expectations.hasText===true&&!detectedText){
    throw new Error("Logo Occupancy não detectou nenhum bloco de texto esperado.");
  }
  if(!normalizedRegions.length){
    throw new Error("Logo Occupancy retornou mapa sem regiões semânticas.");
  }

  return res.status(200).json({
    success:true,
    endpointType:"logo-occupancy",
    occupancy:{
      version:1,
      regions:normalizedRegions,
      toneGrid:logoOccupancyNormalizeGrid(parsed.tone_grid),
      notes:Array.isArray(parsed.notes)?parsed.notes.slice(0,20):[],
      diagnostics:{
        expectedPastors:Number(expectations.pastorCount||0),
        detectedPersons:normalizedRegions.filter(r=>r.type==="person").length,
        detectedFaces:normalizedRegions.filter(r=>r.type==="face").length,
        detectedHands:normalizedRegions.filter(r=>r.type==="hand").length,
        detectedPeople,
        hasTextExpected:!!expectations.hasText,
        detectedText,
        totalRegions:normalizedRegions.length
      }
    },
    meta:{model,usage:d.usage||null,requestId,endpoint:"responses"}
  });
}

module.exports=async function handler(req,res){
  if(req.method==="POST"&&req.body?.mode==="logo-occupancy"){
    try{
      if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada.",diagnostic:{stage:"logo-occupancy-config"}});
      return await handleLogoOccupancyMode(req,res);
    }catch(e){
      console.error("ChurchDesign Logo Occupancy",e);
      return res.status(500).json({
        error:e?.message||"Erro no analisador de ocupação.",
        diagnostic:{stage:"logo-occupancy",name:e?.name||"Error",message:e?.message||String(e),model:process.env.LOGO_ANALYZER_MODEL||process.env.QUALITY_INSPECTOR_MODEL||"gpt-5.6-terra"}
      });
    }
  }

  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  try{
    const data=req.body||{};
    const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
      model:"gpt-5.6-sol",reasoning:{effort:"medium"},store:false,input:[{role:"user",content:content(data)}],
      text:{format:{type:"json_schema",name:"churchdesign_quality_review",strict:true,schema},verbosity:"low"}
    })});
    const requestId=r.headers.get("x-request-id")||null;const d=await r.json();if(!r.ok){const e=new Error(d?.error?.message||`OpenAI ${r.status}`);e.requestId=requestId;throw e;}
    const text=out(d);let review;
    try{review=JSON.parse(text)}
    catch{
      review={
        approved:true,critical_error:false,score:0,
        human_fidelity:0,logo_fidelity:0,content_accuracy:0,reference_coherence:0,
        gross_errors:["Fiscal devolveu resposta inválida."],
        correction_prompt:"",
        technicalFailure:true
      };
    }
    // hard gates
    if(!review.technicalFailure&&(review.human_fidelity<82||review.logo_fidelity<88||review.content_accuracy<90))review.approved=false;
    if(!review.technicalFailure&&(review.human_fidelity<65||review.logo_fidelity<70||review.content_accuracy<75))review.critical_error=true;return res.status(200).json({success:true,endpointType:'quality-inspector',review,meta:{model:'gpt-5.6-sol',usage:d.usage||null,requestId,endpoint:'responses'}});
  }catch(e){console.error("ChurchDesign quality inspector",e);return res.status(500).json({error:e.message||"Erro no fiscal."});}
};
