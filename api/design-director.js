module.exports.config={maxDuration:60};
const RESPONSES_URL="https://api.openai.com/v1/responses";

const schema={
type:"object",additionalProperties:false,
required:["visual_summary","style_tags","palette","composition","typography","imagery","textures","graphic_elements","preserve_rules","avoid_rules","generation_prompt"],
properties:{
visual_summary:{type:"string"},
style_tags:{type:"array",items:{type:"string"}},
palette:{type:"object",additionalProperties:false,required:["background","foreground","dominant","secondary","accent","contrast"],properties:{background:{type:"string"},foreground:{type:"string"},dominant:{type:"string"},secondary:{type:"string"},accent:{type:"string"},contrast:{type:"string"}}},
composition:{type:"object",additionalProperties:false,required:["strategy","focal_point","depth","energy","whitespace","layering"],properties:{strategy:{type:"string"},focal_point:{type:"string"},depth:{type:"string"},energy:{type:"string"},whitespace:{type:"string"},layering:{type:"string"}}},
typography:{type:"object",additionalProperties:false,required:["title","subtitle","supporting"],properties:{
title:{type:"object",additionalProperties:false,required:["style","treatment","uppercase","rotation","scale","tracking","outline","outlineWidth","outlineColor","shadow","fill"],properties:{style:{type:"string"},treatment:{type:"string"},uppercase:{type:"boolean"},rotation:{type:"number"},scale:{type:"number"},tracking:{type:"number"},outline:{type:"boolean"},outlineWidth:{type:"number"},outlineColor:{type:"string"},shadow:{type:"number"},fill:{type:"string"}}},
subtitle:{type:"string"},supporting:{type:"string"}}},
imagery:{type:"object",additionalProperties:false,required:["pastor_treatment","cutout_required","background_strategy","illustration_mode","overlap_strategy"],properties:{pastor_treatment:{type:"string"},cutout_required:{type:"boolean"},background_strategy:{type:"string"},illustration_mode:{type:"string"},overlap_strategy:{type:"string"}}},
textures:{type:"array",items:{type:"string"}},graphic_elements:{type:"array",items:{type:"string"}},preserve_rules:{type:"array",items:{type:"string"}},avoid_rules:{type:"array",items:{type:"string"}},generation_prompt:{type:"string"}
}};

function buildContent(data){
const c=[{type:"input_text",text:`Você é um DIRETOR DE ARTE SÊNIOR especializado em cartazes contemporâneos de igreja, conferências, música e social media.
Analise tecnicamente as referências e devolva um blueprint de produção. Foque em composição, hierarquia, recortes, collage, sobreposição, profundidade, fotografia, tipografia display, escala, rotação, contornos, sombras, paleta, textura, grão, halftone, papel, chrome, blur, gradientes, shapes, ritmo e espaço negativo.
Não use adjetivos genéricos. Use linguagem concreta de direção de arte. ANTES de definir composição, tipografia, paleta e complexidade, consulte os campos explícitos de PÚBLICO-ALVO e ESTILO.
Se não estiverem especificados, não invente restrições e decida apenas pelas referências, conteúdo e contexto.
Se estiverem especificados, eles são parte obrigatória da direção criativa e devem influenciar energia, tipografia, composição, acabamento e grau de ousadia.
Não reduza esses estilos a estereótipos caricatos.
REGRA DE ADAPTAÇÕES E OMISSÕES:
- Em artes complementares, qualquer omissão explícita tem prioridade absoluta sobre a fidelidade à referência.
- Se o usuário omitir pregador, recomponha o fundo sem nenhuma pessoa/pregador, mesmo que a arte-base contenha essa pessoa.
- Se omitir logo ou foto da igreja, não preserve esses elementos apenas porque existem na referência.
- Preserve a linguagem visual, não elementos explicitamente proibidos.

REGRA DE TIPOGRAFIA FINAL:
- A própria IA visual deve desenhar TODA a tipografia final.
- Não há renderer externo de texto.
- Data, hora, endereço, subtítulo e nomes devem aparecer uma única vez cada.
- Decida posição, cor, contraste, tamanho e hierarquia como parte integral do design.

REGRA DE FIDELIDADE GEOMÉTRICA:
- Antes de escolher estilo, extraia a geometria da referência.
- Meça conceitualmente onde o pregador está, quanto do canvas ele ocupa e qual enquadramento é usado.
- Preserve a proporção relativa entre pregador, grandes massas tipográficas e áreas vazias.
- Se a referência mostrar busto/peito/cintura, NÃO transforme em corpo inteiro.
- Sem referência ou instrução específica, prefira peito para cima ou cintura para cima; corpo inteiro é exceção.
- Localize e imite a função espacial de sombras, glows, brilhos e grandes letreiros de fundo.
- Se houver um letreiro gigante ao fundo na referência, preserve essa função composicional mesmo que o texto exato mude.
- A referência NÃO dita o aspect ratio final; o target dita o canvas. Adapte a geometria ao target sem criar borda/moldura.

REGRA DE CANVAS NATIVO: o aspect ratio de destino é a própria composição. Nunca planeje uma arte em outra proporção para depois encaixá-la dentro do canvas. Proíba canvas interno, pôster dentro de pôster, barras, margens artificiais e cópia ampliada/desfocada da própria arte para preencher espaço, salvo referência/instrução explícita.
REGRA DE CAMADAS: imagens da igreja pertencem ao BACKGROUND; pregadores recortados pertencem ao FOREGROUND. Pessoas/mãos/cabeças da foto de igreja nunca podem ficar visualmente por cima de pregadores.
REGRA DE UNICIDADE SEMÂNTICA: cada campo (subtítulo, data, hora, endereço, nome de pregador) aparece no máximo uma vez, salvo pedido explícito.
REGRA DE ENQUADRAMENTO HUMANO: por padrão preserve o corpo inteiro do pregador quando a foto permitir. Só recomende crop corporal quando a referência ou instrução justificar claramente. Prefira redimensionar/reorganizar a composição a cortar cabeça, mãos, braços, pernas ou tronco.\nREGRA DE COMPOSIÇÃO PROFISSIONAL: por padrão, não proponha poster-in-poster, quadro dentro de quadro, moldura externa artificial ou card central flutuando no canvas. Só faça isso se estiver claramente na referência ou for pedido. Evite UI-like boxes/cards/cápsulas em informações. Para LOGO, seja ainda mais rígido: uma única logo original, limpa, sem caixa/placa/selo/fundo próprio, sem duplicar símbolo, sem extrair ícone, sem redesenhar. Em telão sem imagem principal, favoreça título centralizado. Com pregador/figura/ilustração, favoreça título em um lado e imagem no lado oposto.
Se houver pessoas visualmente recortadas, cutout_required=true.
Se o título dominar a peça, especifique escala, rotação, outline, sombra e tracking. O Curador Tipográfico é conservador: respeite mode=AI quando houver risco de perda visual. Editabilidade nunca tem prioridade sobre fidelidade.
Mapa semântico: ${JSON.stringify(data.semanticMap||[])}
Instrução: ${data.instruction||"nenhuma"}
Instrução final: ${data.finalInstruction||"nenhuma"}
PREFERÊNCIAS APRENDIDAS DO USUÁRIO: ${data.preferenceProfile?JSON.stringify(data.preferenceProfile):"nenhuma ainda"}
Público-alvo explicitamente escolhido: ${data.audience||"não especificado"}\nPrioridade explícita de posição da logo: ${data.logoPosition||"não especificada; seguir referência ou equilíbrio"}
Estilo explicitamente escolhido: ${data.designStyle||"não especificado"}
Modo de cor predominante: ${data.colorMode||"não especificado"}
Cor manual, se houver: ${data.dominantColor||"não especificada"}
REGRA DE PALETA: se colorMode="reference" e houver referência, ANALISE VISUALMENTE a paleta da referência antes de montar o blueprint e preserve sua família cromática dominante. Não invente uma nova cor principal. Se não houver referência, escolha uma paleta coerente automaticamente. Se colorMode="custom", use a cor manual como direção predominante sem sacrificar contraste.
Efeitos: ${JSON.stringify(data.effects||[])}\nDireção de inspiração sem referência: ${data.inspirationStyle?JSON.stringify(data.inspirationStyle):'não utilizada'}`}];
for(const r of (data.references||[]).slice(0,3)){if(r?.image&&String(r.image).startsWith("data:image/")){c.push({type:"input_image",image_url:r.image,detail:"high"});if(r.note)c.push({type:"input_text",text:`Orientação desta referência: ${r.note}`});}}
return c;
}
function outputText(d){if(typeof d.output_text==="string")return d.output_text;for(const item of d.output||[])if(item.type==="message")for(const part of item.content||[])if(part.type==="output_text"&&part.text)return part.text;return"";}

module.exports=async function handler(req,res){
if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
try{
const data=req.body||{};if(!(data.references||[]).length&&!data.inspirationStyle)return res.status(400).json({error:"Envie uma referência ou escolha uma direção de inspiração."});
const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
model:"gpt-5.6-terra",reasoning:{effort:"medium"},store:false,input:[{role:"user",content:buildContent(data)}],
text:{format:{type:"json_schema",name:"churchdesign_art_direction",strict:true,schema},verbosity:"low"}
})});
const requestId=r.headers.get("x-request-id")||null;const d=await r.json();if(!r.ok){const e=new Error(d?.error?.message||`OpenAI ${r.status}`);e.requestId=requestId;throw e;}
const text=outputText(d);if(!text)throw new Error("Diretor de Arte não devolveu blueprint.");
let artDirection;try{artDirection=JSON.parse(text)}catch{throw new Error("Blueprint inválido.");}
return res.status(200).json({success:true,artDirection,meta:{model:'gpt-5.6-terra',usage:d.usage||null,requestId,endpoint:'responses'}});
}catch(e){console.error("ChurchDesign Design Director",e);return res.status(500).json({error:e.message||"Erro no Diretor de Arte."});}
};
