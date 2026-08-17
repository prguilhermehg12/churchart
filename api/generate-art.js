module.exports.config={maxDuration:180};
const RESPONSES_URL="https://api.openai.com/v1/responses";
const IMAGE_URL="https://api.openai.com/v1/images/generations";
const BUCKET="churchart-assets";

function cfg(){
  const raw=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!raw||!key)throw new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configuradas.");
  return{url:raw.replace(/\/+$/,""),key};
}
function encodePath(path){return String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");}
async function saveBase64ToStorage(base64,label="base"){
  const c=cfg();const path=`default/generated-bases/${Date.now()}-${crypto.randomUUID()}-${String(label).replace(/[^a-z0-9_-]+/gi,"-")}.png`;
  const r=await fetch(`${c.url}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodePath(path)}`,{
    method:"POST",
    headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"image/png","x-upsert":"true"},
    body:Buffer.from(base64,"base64")
  });
  const text=await r.text();if(!r.ok)throw new Error(`Falha ao salvar base: ${text.slice(0,180)}`);
  return`${c.url}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodePath(path)}`;
}
function modelSize(target={}){
  const w=Number(target.width)||1080,h=Number(target.height)||1080,r=w/h;
  if(r>1.18)return"1536x1024";
  if(r<.84)return"1024x1536";
  return"1024x1024";
}
function refsContent(data,prompt){
  const c=[{type:"input_text",text:prompt}];
  const refs=Array.isArray(data.references)&&data.references.length?data.references:(data.reference?[{image:data.reference,note:""}]:[]);
  for(const r of refs.slice(0,3))if(r?.image&&String(r.image).startsWith("data:image/"))c.push({type:"input_image",image_url:r.image,detail:"high"});
  return c;
}
function semantic(data){
  return(data.semanticMap||[]).map((l,i)=>`${i+1}. ${l.type}: x ${Math.round(l.x||0)}%, y ${Math.round(l.y||0)}%, w ${Math.round(l.w||0)}%, h ${Math.round(l.h||0)}%`).join("\n");
}
function artBlueprint(data){
const a=data.artDirection||{};
return `BLUEPRINT DO DIRETOR DE ARTE:
Resumo: ${a.visual_summary||""}
Tags: ${(a.style_tags||[]).join(", ")}
Paleta: ${JSON.stringify(a.palette||{})}
Composição: ${JSON.stringify(a.composition||{})}
Tipografia: ${JSON.stringify(a.typography||{})}
Imagem: ${JSON.stringify(a.imagery||{})}
Texturas: ${(a.textures||[]).join(", ")}
Elementos: ${(a.graphic_elements||[]).join(", ")}
Preservar: ${(a.preserve_rules||[]).join(" | ")}
Evitar: ${(a.avoid_rules||[]).join(" | ")}
Prompt especialista: ${a.generation_prompt||""}`;
}
function buildPrompt(data){
const target=data.target||{},effectText=(data.effects||[]).map(e=>`${e.id} em ${e.target}`).join(", ")||"nenhum",blueprint=artBlueprint(data);
if(data.mode==="adaptation")return `Você é um designer gráfico executando um blueprint de Diretor de Arte sênior.
Adapte a BASE VISUAL para ${target.label||data.format}, ${target.width}x${target.height}, proporção ${target.ratio||""}.
${data.redesign?"Crie layout perceptivelmente diferente mantendo a mesma identidade visual.":"Reorganize com inteligência para a nova proporção."}
${blueprint}
REGRAS: preserve riqueza gráfica, recortes, camadas, textura e energia; não simplifique em caixas genéricas; não escreva texto legível; não gere pessoas finais; não desenhe logos nem rótulos internos. Integre áreas reservadas naturalmente.
Mapa: ${semantic(data)}
Direção: ${data.instruction||"nenhuma"}. Final: ${data.finalInstruction||"nenhuma"}. Efeitos: ${effectText}.`;
return `Você é um designer gráfico executando um blueprint de Diretor de Arte sênior.
Crie uma BASE VISUAL que pertença à MESMA FAMÍLIA VISUAL das referências.
Alvo ${target.width}x${target.height}, proporção ${target.ratio||""}. Variação ${data.variantLabel||data.variantId||"proposta"}: ${data.variantInstruction||""}.
${blueprint}
REGRAS: siga o blueprint com prioridade; reproduza composição, profundidade, collage, recortes, textura, ritmo, cor e gestos gráficos; não reduza a arte a caixas/cartões genéricos; não escreva texto legível; não gere o pregador final; não desenhe logo nem rótulos internos; não deixe vazios brancos artificiais — crie suporte gráfico real para os futuros textos e pessoa.
Mapa: ${semantic(data)}
Direção geral: ${data.instruction||"nenhuma"}. Instruções finais: ${data.finalInstruction||"nenhuma"}. Efeitos: ${effectText}.`;
}
async function responsesAttempt(data,inputFidelity){
const tool={type:"image_generation",model:"gpt-image-1",action:"edit",quality:"medium",size:modelSize(data.target),output_format:"png"};
if(inputFidelity)tool.input_fidelity=inputFidelity;
const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5-mini",store:false,input:[{role:"user",content:refsContent(data,buildPrompt(data))}],tools:[tool],tool_choice:"required"})});
const d=await r.json();if(!r.ok){const e=new Error(d?.error?.message||`OpenAI ${r.status}`);e.status=r.status;throw e;}
const call=(d.output||[]).find(x=>x.type==="image_generation_call"&&x.result);if(!call?.result)throw new Error("gpt-image-1 não retornou imagem.");
return{base64:call.result,modelUsed:`gpt-image-1${inputFidelity?`-${inputFidelity}`:""}`};
}
async function directFallback(data){
  const r=await fetch(IMAGE_URL,{
    method:"POST",
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-image-1",prompt:buildPrompt(data),size:modelSize(data.target),quality:"medium",output_format:"png"})
  });
  const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`Fallback ${r.status}`);
  const b=d?.data?.[0]?.b64_json;if(!b)throw new Error("Fallback não retornou imagem.");
  return{base64:b,modelUsed:"gpt-image-1-direct"};
}
function retryable(e){
  const m=String(e?.message||"").toLowerCase();
  return e?.status===400||e?.status===404||e?.status===429||e?.status>=500||m.includes("support")||m.includes("model")||m.includes("parameter")||m.includes("overload");
}
async function generateOne(data){
const failures=[];
for(const fidelity of ["high",null]){try{return await responsesAttempt(data,fidelity);}catch(e){failures.push(`${fidelity||"compat"}: ${e.message}`);}}
try{return await directFallback(data);}catch(e){throw new Error(`Falha no gerador. ${failures.join(" | ")} | direto: ${e.message}`);}
}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
  try{
    const data=req.body||{};
    if(!data.reference&&!(data.references||[]).length)return res.status(400).json({error:"Envie pelo menos uma referência."});if(!data.artDirection)return res.status(400).json({error:"Blueprint do Diretor de Arte ausente. Refaça a geração."});
    const generated=await generateOne(data);
    const label=data.mode==="adaptation"?(data.target?.label||data.format||"adaptação"):(data.variantLabel||"proposta");
    const url=await saveBase64ToStorage(generated.base64,label);
    return res.status(200).json({success:true,image:{label,url,modelUsed:generated.modelUsed}});
  }catch(e){
    console.error("ChurchDesign V0.12",e);
    return res.status(500).json({error:e.message||"Erro ao gerar."});
  }
};
