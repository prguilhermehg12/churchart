// CHURCHDESIGN — DERIVADOR INDEPENDENTE
// ARQUIVO: DERIV-derivation-inspector-v1.0
// VERSÃO: 1.0
// FINALIDADE: Inspeção visual independente de imagens derivadas dos modos Manual e Pré-pronto.
// INFRAESTRUTURA COMPARTILHADA: autenticação Supabase e membership da igreja ativa.
module.exports.config={maxDuration:120};
const RESPONSES_URL="https://api.openai.com/v1/responses";
async function requireChurchDesignUser(req){
  const raw=String(process.env.SUPABASE_URL||"").replace(/\/+$/,""),anon=process.env.SUPABASE_ANON_KEY;
  if(!raw||!anon)throw Object.assign(new Error("SUPABASE_URL ou SUPABASE_ANON_KEY não configuradas."),{statusCode:500});
  const authorization=String(req.headers.authorization||"");
  if(!/^Bearer\s+\S+/i.test(authorization))throw Object.assign(new Error("Autenticação obrigatória."),{statusCode:401});
  const r=await fetch(raw+"/auth/v1/user",{headers:{apikey:anon,Authorization:authorization}});
  const user=await r.json().catch(()=>null);
  if(!r.ok||!user?.id)throw Object.assign(new Error("Sessão inválida ou expirada."),{statusCode:401});
  return user;
}
function serverCfg(){
  const url=String(process.env.SUPABASE_URL||"").replace(/\/+$/,""),key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw Object.assign(new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configuradas."),{statusCode:500});
  return{url,key};
}
async function verifyChurchAccess(req,user){
  const c=serverCfg(),churchId=String(req.headers["x-church-id"]||req.body?.church_id||"").trim();
  if(!churchId)throw Object.assign(new Error("Igreja ativa não informada."),{statusCode:400});
  const url=c.url+"/rest/v1/church_members?church_id=eq."+encodeURIComponent(churchId)+"&user_id=eq."+encodeURIComponent(user.id)+"&status=eq.active&select=role";
  const r=await fetch(url,{headers:{apikey:c.key,Authorization:"Bearer "+c.key}});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok)throw Object.assign(new Error("Não foi possível verificar o acesso à igreja."),{statusCode:502});
  if(!Array.isArray(rows)||!rows.length)throw Object.assign(new Error("Você não possui acesso a esta igreja."),{statusCode:403});
}
function outputText(data){
  if(typeof data.output_text==="string")return data.output_text;
  for(const item of data.output||[])if(item.type==="message")for(const part of item.content||[])if(part.type==="output_text"&&part.text)return part.text;
  return"";
}
function imageValue(v){
  if(typeof v==="string"&&(/^(https?:\/\/|data:image\/)/i).test(v))return v;
  return"";
}
function buildInput(data){
  const mode=String(data.derivationMode||"");
  const isPreset=mode==="preset";
  const images=[{type:"input_image",image_url:imageValue(data.generatedImage)}];
  for(const ref of (Array.isArray(data.references)?data.references:[]).slice(0,3)){
    const url=imageValue(ref?.image||ref?.url);
    if(url)images.push({type:"input_image",image_url:url});
  }
  const text=[
    "Você é o Fiscal Visual Independente do Derivador ChurchDesign. Inspecione a imagem final usando critérios objetivos.",
    "MODO: "+(isPreset?"PRÉ-PRONTO":"MANUAL")+".",
    "IMAGEM 1: resultado que será entregue. Imagens seguintes, quando existirem: arte-base e referências.",
    "No modo Manual, confira se mudanças atuais foram obedecidas e se elementos não solicitados foram preservados sem recuperar conteúdo antigo.",
    isPreset?"No modo Pré-pronto, confira se a composição respeita o preset e seu blueprint: regiões, lados, escala, camadas, recorte e ausências. Blueprint: "+String(data.finalInstruction||data.userInstruction||"").slice(0,7000):"",
    "Conteúdo obrigatório atual: "+JSON.stringify(data.requiredContent||{}).slice(0,3000),
    "Textos permitidos: "+JSON.stringify(data.allowedTexts||[]).slice(0,2500),
    "Instrução atual: "+String(data.userInstruction||"").slice(0,3000),
    "Omissões solicitadas: "+JSON.stringify(data.omit||[]),
    "Avalie: texto inventado ou ilegível; pessoa/pregador ausente, duplicado ou com identidade evidentemente incompatível com assets; informação obrigatória omitida; logo indevida; composição fora do formato; corte de rosto/texto; no modo Pré-pronto, violação clara da geometria prescrita.",
    "Se não houver erro objetivo que impeça a entrega, aprove. Não exija perfeição estética subjetiva. Não peça mudança apenas por preferência de estilo.",
    "Devolva correction_prompt breve e acionável somente se houver erro objetivo. Não solicite alterações em áreas corretas."
  ].filter(Boolean).join("\n\n");
  return[{type:"input_text",text},...images];
}
const schema={
  type:"object",additionalProperties:false,required:["approved","critical_error","score","gross_errors","correction_prompt"],
  properties:{
    approved:{type:"boolean"},
    critical_error:{type:"boolean"},
    score:{type:"integer",minimum:0,maximum:100},
    gross_errors:{type:"array",items:{type:"string"}},
    correction_prompt:{type:"string"}
  }
};
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
  try{
    const user=await requireChurchDesignUser(req),data=req.body||{};
    await verifyChurchAccess(req,user);
    if(!["manual","preset"].includes(String(data.derivationMode||"")))return res.status(400).json({error:"Modo de derivação inválido."});
    if(!imageValue(data.generatedImage))return res.status(400).json({error:"Imagem gerada ausente ou inválida."});
    const response=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({
      model:"gpt-5.6-terra",reasoning:{effort:"low"},store:false,input:[{role:"user",content:buildInput(data)}],
      text:{format:{type:"json_schema",name:"derivation_visual_review",strict:true,schema},verbosity:"low"}
    })});
    const requestId=response.headers.get("x-request-id")||null,payload=await response.json();
    if(!response.ok)throw Object.assign(new Error(payload?.error?.message||"Falha no Fiscal Visual."),{statusCode:response.status,requestId});
    const raw=outputText(payload);if(!raw)throw new Error("Fiscal Visual não retornou uma avaliação.");
    const review=JSON.parse(raw);
    if(typeof review.approved!=="boolean"||!Array.isArray(review.gross_errors))throw new Error("Contrato de resposta do Fiscal Visual inválido.");
    return res.status(200).json({success:true,endpointType:"derivation-inspector",review,meta:{model:"gpt-5.6-terra",usage:payload.usage||null,requestId,endpoint:"responses"}});
  }catch(e){console.error("ChurchDesign Derivation Inspector",e);return res.status(e.statusCode||500).json({error:e.message||"Erro no Fiscal Visual."});}
};
