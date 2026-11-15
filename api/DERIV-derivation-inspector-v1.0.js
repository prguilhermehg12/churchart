// CHURCHDESIGN — DERIVADOR INDEPENDENTE
// ARQUIVO DE DESTINO: api/DERIV-derivation-inspector-v1.0.js
// DATA DA ALTERAÇÃO: sábado, 14 de novembro de 2026 | 23:40:04 (horário de Fortaleza)
// TÍTULO: Fiscal independente do Derivador
// VERSÃO DO CONTEÚDO: 1.9
// FINALIDADE: fiscalizar a composição YouTube 3 com crop visual permitido somente no título e pregador sobreposto atrás dele; manter os demais critérios e presets.
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
function presetSpatialRelations(blueprint={}){
  const subjects=(Array.isArray(blueprint.elements)?blueprint.elements:[]).filter(e=>!['decor','logo','church_logo','event_logo'].includes(String(e.type||'').toLowerCase()));
  const out=[];
  const label=e=>({preacher:'PREGADOR',title:'TÍTULO',preacher_name:'NOME DO PREGADOR',subtitle:'SUBTÍTULO',date:'DATA',time:'HORÁRIO',address:'ENDEREÇO',info:'INFORMAÇÃO'}[String(e.type||'').toLowerCase()]||String(e.type||'ELEMENTO').toUpperCase());
  for(let a=0;a<subjects.length;a++)for(let b=a+1;b<subjects.length;b++){
    const x=subjects[a],y=subjects[b],cx=(Number(x.x)||0)+(Number(x.w)||0)/2,cy=(Number(x.y)||0)+(Number(x.h)||0)/2,dx=(Number(y.x)||0)+(Number(y.w)||0)/2,dy=(Number(y.y)||0)+(Number(y.h)||0)/2;
    if(Math.abs(cx-dx)>=4)out.push(label(x)+' fica '+(cx<dx?'À ESQUERDA':'À DIREITA')+' de '+label(y)+'; essa relação não pode ser invertida.');
    if(Math.abs(cy-dy)>=5)out.push(label(x)+' fica '+(cy<dy?'ACIMA':'ABAIXO')+' de '+label(y)+'; essa ordem não pode ser invertida.');
  }
  return out.slice(0,24).join(' ');
}
function buildInput(data,traceAuthorized=false){
  const mode=String(data.derivationMode||"");
  const isPreset=mode==="preset";
  const isScreen=String(data.format||data.layoutPresetBlueprint?.format||'').toLowerCase()==='screen';
  const presetName=String(data.layoutPresetBlueprint?.name||'');
  const isYoutube3=isPreset&&presetName==='YouTube 3'&&String(data.format||'').toLowerCase()==='youtube';
  const relationMap=presetSpatialRelations(data.layoutPresetBlueprint||{});
  const titleCropRule=isYoutube3?'YouTube 3: aceite crop visual do título e sobreposição sobre o tronco; mantenha palavras reconhecíveis e pregador central/superior atrás do título, com rosto/cabeça visíveis. Só o título pode cortar; demais textos e a pessoa ficam íntegros.':'Reprove corte de título ou qualquer outro conteúdo essencial; mantenha pelo menos 6% de margem.';
  const images=[{type:"input_image",image_url:imageValue(data.generatedImage)}];
  for(const ref of (Array.isArray(data.references)?data.references:[]).slice(0,3)){
    const url=imageValue(ref?.image||ref?.url);
    if(url)images.push({type:"input_image",image_url:url});
  }
  if(traceAuthorized&&isPreset&&imageValue(data.layoutGuideImage))images.push({type:"input_image",image_url:imageValue(data.layoutGuideImage)});
  const text=[
    "Você é o Fiscal Visual Independente do Derivador ChurchDesign. Inspecione a imagem final usando critérios objetivos.",
    "MODO: "+(isPreset?"PRÉ-PRONTO":"MANUAL")+".",
    "IMAGEM 1: resultado que será entregue. Imagens seguintes, quando existirem: arte-base e referências.",
    traceAuthorized&&isPreset&&imageValue(data.layoutGuideImage)?"No modo rastreado, a última imagem anexada é o guia visual do preset. Compare diretamente a posição do pregador, do título e do nome com esse modelo.":"",
    "No modo Manual, confira se mudanças atuais foram obedecidas e se elementos não solicitados foram preservados sem recuperar conteúdo antigo.",
    isPreset?(isYoutube3?"YouTube 3: siga as regiões/layers do blueprint, com pregador central e superior atrás do título. O título ocupa a faixa central/inferior, pode sobrepor o tronco e receber crop visual intencional; preserve a mensagem completa e reconhecível. Essa exceção vale somente para o título. Data, horário, informação, subtítulo, nome e rosto do pregador devem ficar íntegros e dentro das margens. Não reprove apenas o crop/overlap autorizado. Relações calculadas: "+relationMap+". Mapa: "+JSON.stringify(data.layoutPresetBlueprint||{}).slice(0,3500):"No modo Pré-pronto, compare a imagem com a miniatura e o blueprint: preserve lado, região, ordem acima/abaixo, hierarquia e escala relativa. Essas relações são obrigatórias; reprove se forem invertidas. Aceite pequenos ajustes somente dentro da mesma região, sem exigir coordenadas pixel a pixel. Todo texto essencial deve manter pelo menos 6% de margem; reprove corte, encosto, omissão ou ilegibilidade. Relações calculadas: "+relationMap+". Mapa: "+JSON.stringify(data.layoutPresetBlueprint||{}).slice(0,3500)+". Instruções: "+String(data.finalInstruction||data.userInstruction||"").slice(0,4500)):"",
    "Campos estruturados reais da arte de origem: "+JSON.stringify(data.sourceContentData||{}).slice(0,3000),
    "Conteúdo obrigatório atual: "+JSON.stringify(data.requiredContent||{}).slice(0,3000),
    isPreset?(isYoutube3?"PRESET YOUTUBE 3: título com crop visual intencional e sobreposição sobre o tronco são permitidos; mantenha as palavras completas e reconhecíveis. Pregador central/superior atrás do título, rosto/cabeça inteiros e visíveis acima. Só o título pode sangrar/cortar; todos os demais elementos continuam seguros e nas regiões do blueprint. Não exija que o título caiba na caixa original. Nunca permita espelhamento.":"PRESET — VERIFICAÇÃO ESTRUTURAL: todo título completo (incluindo kicker/faixa) deve preservar todas as palavras, linhas, largura relativa e estilo da origem; exija pelo menos 6% de margem e reprove omissão, palavra deformada ou conteúdo cortado. Compare lado, região, ordem vertical e escala relativa de todos os itens com o blueprint; aceite apenas ajustes finos dentro da mesma região. Nunca permita espelhamento. Para Telão 1, o bloco título+kicker tem centro X=50%,Y=50% (tolerância 1%); Telão 4 deve permanecer menor na região inferior direita. Avalie fundo escuro se ativo."):"",
    "Campos escritos da arte-base: "+JSON.stringify(data.sourceContentData||{}).slice(0,3000),
    "Leitura visual estruturada do título: "+JSON.stringify(data.sourceAnalysis||{}).slice(0,5000)+". Se title estiver incluído, confirme cada componente e cada linha, especialmente title_kicker como ABRA MÃO; verifique ordem, quebra e largura relativa. A análise é auxiliar à comparação visual, não invente texto.",
    data.preferDarkBackground?"Priorizar fundo escuro está ATIVO: confira se o fundo geral ficou predominantemente escuro sem destruir identidade, textura e elementos visuais.":"",
    "Textos permitidos: "+JSON.stringify(data.allowedTexts||[]).slice(0,2500),
    "Instrução atual: "+String(data.userInstruction||"").slice(0,3000),
    "Omissões solicitadas: "+JSON.stringify(data.omit||[]),
    "Avalie: texto inventado ou ilegível; componentes do título ausentes; título cortado de modo que palavras não sejam reconhecíveis; quebra de linha, hierarquia, largura ou escala do título incompatível com a origem; pessoa/pregador ausente, duplicado ou com identidade incompatível; informação obrigatória omitida; logo indevida; formato errado; no modo Pré-pronto, inversão da ordem do preset. Compare a pessoa com a arte-base usando marcas assimétricas (rosto, direção do olhar, mão do microfone, púlpito, roupa): qualquer espelhamento horizontal/vertical é erro crítico; reposicionar e recortar sem inverter é permitido. "+titleCropRule+" Preserve ordem, quebras, proporções relativas das linhas e todos os title_kicker detectados, inclusive ABRA MÃO; não aceite omissão de palavras nem alargamento isolado como VOCÊ!. Se o preset não prevê pregador e não há pedido explícito para adicioná-lo, reprove se a pessoa focal da origem continuar visível. O comando Priorizar fundo escuro deve escurecer o fundo sem apagar grafismos.", 
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
    const traceAuthorized=data.traceMode===true&&String(user.email||'').trim().toLowerCase()==='pr.guilhermehg12@gmail.com';
    const isPreset=String(data.derivationMode||'')==='preset';
    await verifyChurchAccess(req,user);
    if(!["manual","preset"].includes(String(data.derivationMode||"")))return res.status(400).json({error:"Modo de derivação inválido."});
    if(!imageValue(data.generatedImage))return res.status(400).json({error:"Imagem gerada ausente ou inválida."});
    const inputContent=buildInput(data,traceAuthorized);
    const response=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({
      model:"gpt-5.6-terra",reasoning:{effort:"low"},store:false,input:[{role:"user",content:inputContent}],
      text:{format:{type:"json_schema",name:"derivation_visual_review",strict:true,schema},verbosity:"low"}
    })});
    const requestId=response.headers.get("x-request-id")||null,payload=await response.json();
    if(!response.ok)throw Object.assign(new Error(payload?.error?.message||"Falha no Fiscal Visual."),{statusCode:response.status,requestId});
    const raw=outputText(payload);if(!raw)throw new Error("Fiscal Visual não retornou uma avaliação.");
    const review=JSON.parse(raw);
    if(typeof review.approved!=="boolean"||!Array.isArray(review.gross_errors))throw new Error("Contrato de resposta do Fiscal Visual inválido.");
    const trace=traceAuthorized?{agent:'Fiscal visual do Derivador',received:{mode:data.derivationMode||null,presetBlueprint:data.layoutPresetBlueprint||null,requiredContent:data.requiredContent||{},sourceContentData:data.sourceContentData||{},sourceAnalysis:data.sourceAnalysis||null,preferDarkBackground:!!data.preferDarkBackground,userInstruction:data.userInstruction||'',finalInstruction:data.finalInstruction||'',omissions:data.omit||[]},sent:{model:'gpt-5.6-terra',prompt:inputContent.find(x=>x.type==='input_text')?.text||'',images:[{index:1,role:'resultado gerado'},...(Array.isArray(data.references)?data.references.slice(0,3).map((r,i)=>({index:i+2,role:r?.note||'arte-base/referência'})):[]),...(traceAuthorized&&isPreset&&imageValue(data.layoutGuideImage)?[{index:2+(Array.isArray(data.references)?Math.min(data.references.length,3):0),role:'guia visual do preset'}]:[])]},decision:{approved:review.approved,critical_error:review.critical_error,score:review.score,gross_errors:review.gross_errors,correction_prompt:review.correction_prompt},response:{model:'gpt-5.6-terra',usage:payload.usage||null,requestId}}:undefined;
    return res.status(200).json({success:true,endpointType:"derivation-inspector",review,meta:{model:"gpt-5.6-terra",usage:payload.usage||null,requestId,endpoint:"responses"},...(trace?{trace}:{})});
  }catch(e){console.error("ChurchDesign Derivation Inspector",e);return res.status(e.statusCode||500).json({error:e.message||"Erro no Fiscal Visual."});}
};

