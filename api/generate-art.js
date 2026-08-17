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
  if(data.assets?.pastor?.image)c.push({type:"input_text",text:"FOTO ORIGINAL DO PREGADOR. Preserve identidade, rosto, cabelo, barba, óculos, idade aparente e características individuais com máxima fidelidade."},{type:"input_image",image_url:data.assets.pastor.image,detail:"high"});
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
    c.address?`ENDEREÇO EXATO: ${c.address}`:""
  ].filter(Boolean).join("\n");
  return `Crie uma ARTE FINAL profissional para igreja, pronta para publicação.

Use as referências como referência real de DESIGN: composição, hierarquia, tratamento tipográfico, recortes, textura, paleta, profundidade e linguagem visual.
NÃO crie uma base vazia para ser montada depois. Resolva a peça completa como um designer.

${blueprint(data)}

CONTEÚDO QUE DEVE APARECER EXATAMENTE:
${texts||"Sem textos obrigatórios."}

IGREJA: ${data.church?.name||""}
Se uma LOGO oficial foi fornecida, use a logo e NÃO repita o nome da igreja em texto separado.

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
INSTRUÇÃO DO USUÁRIO: ${data.instruction||""}
INSTRUÇÃO FINAL: ${data.finalInstruction||""}
CORREÇÃO DO FISCAL, se houver: ${data.qualityCorrection||"nenhuma"}

Entregue a arte final, não um mockup.`;
}
async function generate(data){
  const tool={type:"image_generation",model:"gpt-image-1",action:"edit",quality:"medium",size:modelSize(data.target),output_format:"png",input_fidelity:"high"};
  const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
    model:"gpt-5-mini",store:false,input:[{role:"user",content:inputContent(data,prompt(data))}],tools:[tool],tool_choice:"required"
  })});
  const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);
  const call=(d.output||[]).find(x=>x.type==="image_generation_call"&&x.result);if(!call?.result)throw new Error("O gerador não retornou imagem.");
  return call.result;
}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
  try{
    const data=req.body||{};if(!(data.references||[]).length)return res.status(400).json({error:"Envie pelo menos uma referência."});
    const base64=await generate(data),label=data.variantLabel||data.target?.label||"arte";
    const url=await saveBase64ToStorage(base64,label);
    return res.status(200).json({success:true,image:{label,url,modelUsed:"gpt-image-1-high-fidelity"}});
  }catch(e){console.error("ChurchDesign V0.13 generate",e);return res.status(500).json({error:e.message||"Erro ao gerar."});}
};
