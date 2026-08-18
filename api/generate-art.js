module.exports.config={maxDuration:180};

const RESPONSES_URL="https://api.openai.com/v1/responses";
const BUCKET="churchart-assets";

function cfg(){
  const raw=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!raw||!key)throw new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configuradas.");
  return{url:raw.replace(/\/+$/,""),key};
}
function encodePath(path){return String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");}
async function saveBase64ToStorage(base64,label="art"){
  const c=cfg(),path=`default/generated-final/${Date.now()}-${crypto.randomUUID()}-${String(label).replace(/[^a-z0-9_-]+/gi,"-")}.png`;
  const r=await fetch(`${c.url}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodePath(path)}`,{
    method:"POST",headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"image/png","x-upsert":"true"},body:Buffer.from(base64,"base64")
  });
  const text=await r.text();if(!r.ok)throw new Error(`Falha ao salvar arte: ${text.slice(0,180)}`);
  return`${c.url}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodePath(path)}`;
}
function modelSize(target={}){
  const w=Number(target.width)||1080,h=Number(target.height)||1350,r=w/h;
  if(r>1.18)return"1536x1024";if(r<.84)return"1024x1536";return"1024x1024";
}
function inputContent(data,prompt){
  const c=[{type:"input_text",text:prompt}];
  for(const r of (data.references||[]).slice(0,3))if(r?.image)c.push({type:"input_image",image_url:r.image,detail:"high"});
  for(const [i,p] of (data.assets?.pastors||[data.assets?.pastor].filter(Boolean)).entries())if(p?.image)c.push({type:"input_text",text:`FOTO ORIGINAL DO PREGADOR ${i+1}. Nome solicitado: ${p.name||'não informado'}. Preserve identidade, rosto, cabelo, barba, óculos, idade aparente e características individuais com máxima fidelidade. Se houver nome, posicione-o próximo desta pessoa de forma harmônica, legível e com contraste suficiente.`},{type:"input_image",image_url:p.image,detail:"high"});
  if(data.assets?.churchImage?.image)c.push({type:"input_text",text:"FOTO DA IGREJA OBRIGATÓRIA. Esta imagem foi escolhida pelo usuário e deve aparecer claramente integrada ao fundo/ambiente da arte. Não substitua por outra igreja e não a ignore."},{type:"input_image",image_url:data.assets.churchImage.image,detail:"high"});
  if(data.assets?.logo?.image)c.push({type:"input_text",text:"LOGO OFICIAL. Use esta marca exatamente como fornecida. Não redesenhe, não invente letras e não altere símbolo."},{type:"input_image",image_url:data.assets.logo.image,detail:"high"});
  return c;
}
function blueprint(data){const a=data.artDirection||{};return `Direção visual: ${a.visual_summary||""}
Estilo: ${(a.style_tags||[]).join(", ")}
Paleta: ${JSON.stringify(a.palette||{})}
Composição: ${JSON.stringify(a.composition||{})}
Tipografia: ${JSON.stringify(a.typography||{})}
Imagem: ${JSON.stringify(a.imagery||{})}
Texturas: ${(a.textures||[]).join(", ")}
Elementos: ${(a.graphic_elements||[]).join(", ")}
Preservar: ${(a.preserve_rules||[]).join(" | ")}
Evitar: ${(a.avoid_rules||[]).join(" | ")}
Orientação especializada: ${a.generation_prompt||""}`;}
function prompt(data){
  const c=data.requiredContent||{},target=data.target||{};
  const texts=[
    c.title?`TÍTULO EXATO: ${c.title}`:"",
    c.subtitle?`SUBTÍTULO EXATO: ${c.subtitle}`:"",
    c.date?`DATA EXATA: ${c.date}`:"",
    c.time?`HORÁRIO EXATO: ${c.time}`:"",
    c.address?`ENDEREÇO EXATO: ${c.address}`:"",
    ...(Array.isArray(c.pastorNames)?c.pastorNames.filter(Boolean).map((n,i)=>`NOME DO PREGADOR ${i+1} EXATO: ${n}`):[])
  ].filter(Boolean).join("\n");
  return `Crie uma ARTE FINAL profissional para igreja, pronta para publicação.

${(data.references||[]).length?'Use as referências como referência real de DESIGN: composição, hierarquia, tratamento tipográfico, recortes, textura, paleta, profundidade e linguagem visual.':`CRIAÇÃO SEM REFERÊNCIA: desenvolva uma proposta original a partir desta direção: ${data.inspirationStyle?.name||''} — ${data.inspirationStyle?.prompt||''}. Não copie uma peça específica.`}
NÃO crie uma base vazia para ser montada depois. Resolva a peça completa como um designer.

${blueprint(data)}

CONTEÚDO QUE DEVE APARECER EXATAMENTE:
${texts||"Sem textos obrigatórios."}

IGREJA: ${data.church?.name||""}
PÚBLICO-ALVO ESCOLHIDO: ${data.audience||"não especificado"}
ESTILO ESCOLHIDO: ${data.designStyle||"não especificado"}
Se uma LOGO oficial foi fornecida, use a logo e NÃO repita o nome da igreja em texto separado.

REGRA DE FOTO DA IGREJA:
- Se data.assets.churchImage foi fornecida, o uso dessa foto é obrigatório no ambiente/fundo e deve ser visualmente reconhecível.
- Se não foi fornecida e a referência já possui ambiente de igreja, congregação ou adoração ao fundo, preserve esse tipo de ambiente da referência.
- Não crie silhuetas humanas apenas para preencher lugares vazios.

REGRA DE COMPOSIÇÃO ADAPTATIVA:
- A referência é uma linguagem visual, NÃO um molde rígido.
- Conte quantas pessoas existem nas fotos realmente fornecidas. Use SOMENTE essas pessoas.
- Se a referência tiver mais pessoas do que foram fornecidas, NÃO crie silhuetas, sombras, manequins, espaços vazios ou pessoas inventadas para preencher posições.
- Refaça a composição de forma coesa para a quantidade real de pessoas.
- Uma pessoa deve receber uma composição intencional de protagonista; duas devem ser equilibradas; três podem usar composição de trio.
- Preserve a sensação, hierarquia, energia, paleta, tipografia, recortes e texturas da referência, mas adapte geometria, escala e espaços.
- Nunca interprete ausência de uma foto como pedido para reservar um espaço para ela.
- Se houver apenas um pregador, faça a arte parecer desenhada originalmente para UM pregador.



TRAVA GEOMÉTRICA DE SAFE FRAME — REGRA CRÍTICA:
- Trate os 12% externos de CADA LADO como zona proibida para conteúdo essencial.
- Todo texto, título, subtítulo, data, hora, endereço, logo, nome de pregador, rosto e cabeça deve ficar integralmente dentro do retângulo central de 76% da largura por 76% da altura.
- Nada essencial pode tocar a borda. Nada essencial pode ser parcialmente cortado.
- Faça o layout MENOR e mais central se houver qualquer dúvida. Espaço vazio nas bordas é aceitável; conteúdo cortado não é.
- Elementos abstratos/texturas podem sangrar; informação e pessoas nunca.
- Faça uma revisão final das quatro bordas antes de concluir.

REGRA DE CONTRASTE DA LOGO:
- A logo oficial deve permanecer com suas cores originais.
- Nunca coloque logo branca/clara sobre região clara e nunca coloque logo preta/escura sobre região escura.
- Se o fundo não oferecer contraste, crie discretamente atrás da logo uma área/placa/halo compatível com o design. NÃO altere a cor da logo para resolver contraste.

REGRA DE SAFE AREA / ÁREA SEGURA:
- Nenhum texto, logo, rosto, data, horário, endereço ou informação essencial pode encostar, ultrapassar ou ficar parcialmente fora do canvas.
- Reserve no mínimo 8% de margem interna em TODOS os lados para conteúdo essencial.
- Em formatos verticais, não coloque títulos ou endereços colados no topo ou na base.
- Em formatos horizontais, proteja especialmente as laterais.
- Elementos decorativos podem sangrar para fora; conteúdo essencial, jamais.
- Antes de finalizar, revise mentalmente as quatro bordas e confirme que nada importante está cortado.

REGRAS DE FIDELIDADE:
- A foto do pregador fornecida é uma identidade protegida. Preserve a pessoa; não invente outro rosto.
- Se não conseguir uma transformação sofisticada sem alterar a identidade, use um recorte/tratamento mais simples e fiel.
- Logo oficial: preservar exatamente. Não redesenhar.
- Não invente datas, horários, endereço, nomes, slogans ou textos.
- Não escreva rótulos internos como "logo", "reserva", "pregador" ou nomes de camada.
- Complexidade visual somente quando for coerente e segura. Coerência sempre.
- Título deve fazer parte do design: escala, composição, contraste, possível inclinação, outline, sombra ou deformação quando coerente com a referência.
- Integre pessoas, título e elementos em camadas, evitando aparência de formulário/cartões genéricos.

FORMATO FINAL: ${target.width||1080}x${target.height||1350}, proporção ${target.ratio||""}
VARIAÇÃO: ${data.variantLabel||"principal"} — ${data.variantInstruction||""}
INSTRUÇÃO DO USUÁRIO: ${data.instruction||""}\nSe público-alvo ou estilo tiverem sido especificados, siga a interpretação que o DIRETOR DE ARTE já incorporou ao blueprint.
Use também os campos explícitos acima como trava de consistência.
Se estiverem como 'não especificado', não force nenhum estilo ou público artificialmente.
INSTRUÇÃO FINAL: ${data.finalInstruction||""}
CORREÇÃO DO FISCAL, se houver: ${data.qualityCorrection||"nenhuma"}

${data.safeMode?`MODO SEGURO OBRIGATÓRIO:
- reduza a complexidade;
- não deforme o rosto;
- não estilize a pessoa de forma que altere sua identidade;
- trate a foto do pregador como fotografia real recortada/encaixada;
- preserve logo sem redesenhar;
- use tipografia forte porém simples;
- não use distorções em textos obrigatórios;
- todos os dados precisam estar legíveis e corretos;
- prefira fundo gráfico simples e profissional a uma composição arriscada.`:""}

Entregue a arte final, não um mockup.`;
}
async function generate(data){
  const tool={type:"image_generation",model:"gpt-image-2",action:"edit",quality:"medium",size:modelSize(data.target),output_format:"png"};
  const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
    model:"gpt-5.6-sol",reasoning:{effort:"medium"},store:false,input:[{role:"user",content:inputContent(data,prompt(data))}],tools:[tool],tool_choice:"required"
  })});
  const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);
  const call=(d.output||[]).find(x=>x.type==="image_generation_call"&&x.result);if(!call?.result)throw new Error("O gerador não retornou imagem.");
  return call.result;
}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
  try{
    const data=req.body||{};if(!(data.references||[]).length&&!data.inspirationStyle&&!data.artDirection)return res.status(400).json({error:"Forneça uma referência ou uma direção de inspiração."});
    const base64=await generate(data),label=data.variantLabel||data.target?.label||"arte";
    const url=await saveBase64ToStorage(base64,label);
    return res.status(200).json({success:true,image:{label,url,modelUsed:"gpt-image-2-high"}});
  }catch(e){console.error("ChurchDesign V0.13 generate",e);return res.status(500).json({error:e.message||"Erro ao gerar."});}
};
