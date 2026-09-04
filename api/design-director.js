async function requireChurchDesignUser(req){
  const raw=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const anon=process.env.SUPABASE_ANON_KEY;
  if(!raw||!anon)throw Object.assign(new Error("SUPABASE_URL ou SUPABASE_ANON_KEY não configuradas."),{statusCode:500});
  const authorization=String(req.headers.authorization||"");
  if(!/^Bearer\s+\S+/i.test(authorization))throw Object.assign(new Error("Autenticação obrigatória."),{statusCode:401});
  const r=await fetch(`${raw}/auth/v1/user`,{headers:{apikey:anon,Authorization:authorization}});
  const user=await r.json().catch(()=>null);
  if(!r.ok||!user?.id)throw Object.assign(new Error("Sessão inválida ou expirada."),{statusCode:401});
  return user;
}
function serverCfg(){
  const raw=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!raw||!key)throw Object.assign(new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configuradas."),{statusCode:500});
  return {url:raw,key};
}
async function serverRest(path,opt={}){
  const c=serverCfg();const r=await fetch(`${c.url}/rest/v1/${path}`,{...opt,headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"application/json",...(opt.headers||{})}});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw Object.assign(new Error(data?.message||data?.error||`Supabase ${r.status}`),{statusCode:r.status});return data;
}
function churchIdFromRequest(req){const id=String(req.headers['x-church-id']||req.body?.church_id||'').trim();if(!id)throw Object.assign(new Error("Igreja ativa não informada."),{statusCode:400});return id}
async function requireChurchAccess(req,user){
  const churchId=churchIdFromRequest(req);const rows=await serverRest(`church_members?church_id=eq.${encodeURIComponent(churchId)}&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=role`);
  if(!rows?.length)throw Object.assign(new Error("Você não possui acesso a esta igreja."),{statusCode:403});return churchId;
}
function usageNumber(u,...paths){for(const path of paths){let v=u;for(const k of path.split('.'))v=v?.[k];if(Number.isFinite(Number(v)))return Number(v)}return null}

const USAGE_PRICE_VERSION="2026-08-18";
const USAGE_COST_RATES={
  "gpt-5.6-sol":{kind:"text",input:5,cached:.5,output:30},
  "gpt-5.6":{kind:"text",input:5,cached:.5,output:30},
  "gpt-5.6-terra":{kind:"text",input:2,cached:.2,output:12},
  "gpt-5.6-luna":{kind:"text",input:.2,cached:.02,output:1.2},
  "gpt-image-2":{kind:"image",text_input:5,text_cached:1.25,text_output:10,image_input:8,image_cached:2,image_output:30}
};
function usageCostEstimate(model,usage){
  if(!usage)return 0;
  const r=USAGE_COST_RATES[model]||USAGE_COST_RATES["gpt-5.6-sol"];
  const num=(...paths)=>usageNumber(usage,...paths)||0;
  if(r.kind==="text"){
    const input=num("input_tokens","prompt_tokens"),output=num("output_tokens","completion_tokens"),cached=num("input_tokens_details.cached_tokens","prompt_tokens_details.cached_tokens");
    return ((Math.max(0,input-cached)*r.input)+(cached*r.cached)+(output*r.output))/1e6;
  }
  const ti=num("input_tokens_details.text_tokens","input_details.text_tokens","text_input_tokens");
  const ii=num("input_tokens_details.image_tokens","input_details.image_tokens","image_input_tokens");
  const ci=num("input_tokens_details.cached_tokens","input_details.cached_tokens");
  const to=num("output_tokens_details.text_tokens","output_details.text_tokens","text_output_tokens");
  const io=num("output_tokens_details.image_tokens","output_details.image_tokens","image_output_tokens");
  const input=num("input_tokens","prompt_tokens"),output=num("output_tokens","completion_tokens");
  if(ti||ii||to||io){
    const imageCached=Math.min(ii,ci),textCached=Math.max(0,ci-imageCached);
    return ((Math.max(0,ti-textCached)*r.text_input)+(textCached*r.text_cached)+(Math.max(0,ii-imageCached)*r.image_input)+(imageCached*r.image_cached)+(to*r.text_output)+(io*r.image_output))/1e6;
  }
  return ((input*r.image_input)+(output*r.image_output))/1e6;
}
function costContextFromData(data={}){
  const ctx=data.costContext||{},target=data.target||{};
  let artType=ctx.artType||"";
  if(!artType){
    if(data.backgroundMode)artType="Fundo";
    else if(data.freeMode)artType="Modo Livre";
    else if(data.screenThemeMode)artType="Telão Tema";
    else if(data.revisionMode)artType="Correção";
    else if(data.mode==="adaptation")artType="Derivada";
    else artType="Arte base";
  }
  return{
    cost_session_id:String(data.costSessionId||ctx.sessionId||"")||null,
    project_name:String(ctx.projectName||data.projectName||data.requiredContent?.title||"").trim()||null,
    art_type:artType,
    format:String(ctx.format||data.format||target.id||"").trim()||null,
    target_label:String(ctx.targetLabel||target.label||"").trim()||null,
    mode:String(data.mode||"").trim()||null,
    variant_label:String(data.variantLabel||"").trim()||null,
    background_mode:!!data.backgroundMode,
    free_mode:!!data.freeMode,
    screen_theme_mode:!!data.screenThemeMode,
    revision_mode:String(data.revisionMode||"").trim()||null
  };
}
async function logUsage({churchId,userId,operationType,model,endpoint,usage,imageCount=0,metadata={}}){
  try{
    const costUSD=usageCostEstimate(model,usage),fx=Number(process.env.COST_USD_BRL_RATE)||null;
    await serverRest("generation_usage",{method:"POST",body:JSON.stringify([{
      church_id:churchId,user_id:userId,operation_type:operationType,model,endpoint,
      input_tokens:usageNumber(usage,'input_tokens','prompt_tokens'),
      output_tokens:usageNumber(usage,'output_tokens','completion_tokens'),
      image_count:imageCount,
      cost_usd:costUSD||0,
      cost_brl:fx?costUSD*fx:null,
      currency_rate:fx,
      metadata:{...metadata,usage:usage||null,pricing_version:USAGE_PRICE_VERSION,cost_estimated:true}
    }])});
  }catch(e){console.error("Usage log",e.message)}
}

module.exports.config={maxDuration:60};
const RESPONSES_URL="https://api.openai.com/v1/responses";

const schema={
type:"object",additionalProperties:false,
required:["visual_summary","style_tags","palette","composition","typography","imagery","textures","graphic_elements","preserve_rules","avoid_rules","protected_assets","generation_prompt"],
properties:{
visual_summary:{type:"string"},
style_tags:{type:"array",items:{type:"string"}},
palette:{type:"object",additionalProperties:false,required:["background","foreground","dominant","secondary","accent","contrast"],properties:{background:{type:"string"},foreground:{type:"string"},dominant:{type:"string"},secondary:{type:"string"},accent:{type:"string"},contrast:{type:"string"}}},
composition:{type:"object",additionalProperties:false,required:["strategy","focal_point","depth","energy","whitespace","layering"],properties:{strategy:{type:"string"},focal_point:{type:"string"},depth:{type:"string"},energy:{type:"string"},whitespace:{type:"string"},layering:{type:"string"}}},
typography:{type:"object",additionalProperties:false,required:["title","subtitle","supporting"],properties:{
title:{type:"object",additionalProperties:false,required:["style","treatment","uppercase","rotation","scale","tracking","outline","outlineWidth","outlineColor","shadow","fill"],properties:{style:{type:"string"},treatment:{type:"string"},uppercase:{type:"boolean"},rotation:{type:"number"},scale:{type:"number"},tracking:{type:"number"},outline:{type:"boolean"},outlineWidth:{type:"number"},outlineColor:{type:"string"},shadow:{type:"number"},fill:{type:"string"}}},
subtitle:{type:"string"},supporting:{type:"string"}}},
imagery:{type:"object",additionalProperties:false,required:["pastor_treatment","cutout_required","background_strategy","illustration_mode","overlap_strategy"],properties:{pastor_treatment:{type:"string"},cutout_required:{type:"boolean"},background_strategy:{type:"string"},illustration_mode:{type:"string"},overlap_strategy:{type:"string"}}},
protected_assets:{type:"object",additionalProperties:false,required:["church_logo_region","church_logo_width_pct","event_logo_region","event_logo_width_pct"],properties:{
church_logo_region:{type:"string",enum:["top-left","top-center","top-right","bottom-left","bottom-center","bottom-right","none"]},
church_logo_width_pct:{type:"number"},
event_logo_region:{type:"string",enum:["left-top","right-top","left-middle","right-middle","left-bottom","right-bottom","none"]},
event_logo_width_pct:{type:"number"}
}},
textures:{type:"array",items:{type:"string"}},graphic_elements:{type:"array",items:{type:"string"}},preserve_rules:{type:"array",items:{type:"string"}},avoid_rules:{type:"array",items:{type:"string"}},generation_prompt:{type:"string"}
}};

function buildContent(data){
const c=[{type:"input_text",text:`Você é um DIRETOR DE ARTE SÊNIOR especializado em cartazes contemporâneos de igreja, conferências, música e social media.

CONTRATO DE REFERÊNCIA — STYLE ONLY / ZERO SEMANTIC INHERITANCE:
- A referência fornece SOMENTE composição, hierarquia, proporções, estilo tipográfico, tratamento das fontes, textura, iluminação, recortes, geometria, ritmo visual, profundidade, tratamento fotográfico e paleta quando permitido pela escolha de cor do usuário.
- NUNCA transporte palavras, números, datas, horários, endereços, nomes de culto, nomes de igreja, slogans, frases, logos, marcas ou qualquer conteúdo legível da referência.
- Uma palavra grande na referência significa apenas “massa tipográfica grande nesta região”; o texto real vem EXCLUSIVAMENTE dos campos atuais.
- Se a referência contém SEGUNDA, DOMINGO, CELEBRAÇÃO, nome de igreja ou qualquer outro texto, descarte esse conteúdo.
- Se colorMode="custom", a cor do usuário tem prioridade sobre a referência.
- O gerador visual NÃO receberá a referência externa na geração inicial; por isso descreva o design com precisão suficiente no blueprint, sem conteúdo semântico.

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
REGRA DE ENQUADRAMENTO HUMANO: por padrão preserve o corpo inteiro do pregador quando a foto permitir. Só recomende crop corporal quando a referência ou instrução justificar claramente. Prefira redimensionar/reorganizar a composição a cortar cabeça, mãos, braços, pernas ou tronco.\nREGRA DE COMPOSIÇÃO PROFISSIONAL: por padrão, não proponha poster-in-poster, quadro dentro de quadro, moldura externa artificial ou card central flutuando no canvas. Só faça isso se estiver claramente na referência ou for pedido. Evite UI-like boxes/cards/cápsulas em informações.

ARQUITETURA DE LOGOS — REGRA ABSOLUTA:
- A IA VISUAL NÃO desenhará, reconstruirá, copiará nem escreverá nenhuma logo.
- Toda logo existente nas REFERÊNCIAS deve ser tratada como elemento a REMOVER da geração visual.
- Seu trabalho é somente reservar espaço e indicar em protected_assets onde o compositor determinístico colará o PNG original depois.
- Se houver logo da igreja e logo de evento, reserve áreas distintas.
- Se o usuário escolheu posição explícita da logo da igreja, respeite-a.
- Sem posição explícita, preserve apenas a REGIÃO da logo na referência, nunca a marca em si.
- Para logo de evento, use uma das seis regiões centrais laterais e mantenha distância de pregadores, título e dados essenciais.
- Como a logo será colada depois, NÃO planeje sobreposição com pregadores. Escolha um ponto limpo dentro da região.
- church_logo_width_pct normalmente entre 12 e 26.
- event_logo_width_pct respeita small≈14, medium≈20, large≈26.
- Logo omitida/inexistente => região "none" e largura 0.

Em telão sem imagem principal, favoreça título centralizado. Com pregador/figura/ilustração, favoreça título em um lado e imagem no lado oposto.
Se houver pessoas visualmente recortadas, cutout_required=true.
Se o título dominar a peça, especifique escala, rotação, outline, sombra e tracking. O Curador Tipográfico é conservador: respeite mode=AI quando houver risco de perda visual. Editabilidade nunca tem prioridade sobre fidelidade.
Mapa semântico: ${JSON.stringify(data.semanticMap||[])}
Instrução: ${data.instruction||"nenhuma"}
Instrução final: ${data.finalInstruction||"nenhuma"}
PREFERÊNCIAS APRENDIDAS DO USUÁRIO: ${data.preferenceProfile?JSON.stringify(data.preferenceProfile):"nenhuma ainda"}
TEXTOS AUTORIZADOS DA ARTE ATUAL: ${JSON.stringify([data.requiredContent?.title,data.requiredContent?.subtitle,data.requiredContent?.date,data.requiredContent?.time,data.requiredContent?.address,data.requiredContent?.churchName,...(data.requiredContent?.pastorNames||[])].filter(Boolean))}
QUALQUER OUTRO TEXTO LEGÍVEL VINDO DA REFERÊNCIA É PROIBIDO.
Público-alvo explicitamente escolhido: ${data.audience||"não especificado"}\nPrioridade explícita de posição da logo: ${data.logoPosition||"não especificada; seguir referência ou equilíbrio"}\nZona da logo de evento: ${data.eventLogoPosition||"IA escolhe entre as seis zonas centrais permitidas"}\nTamanho máximo da logo de evento: ${data.eventLogoSize||"small"} (small≈14% da largura; medium≈20%; large≈26%). A zona é aproximada: ajuste localmente para composição sem abandonar a região escolhida.\nLogo principal omitida: ${data.omitChurchLogo?"SIM — proibir logo principal":"não"}\nNome da igreja omitido: ${data.omitChurchName?"SIM — proibir qualquer texto com o nome da igreja":"não"}

ATIVOS SAGRADOS / CAMADAS INDEPENDENTES:
- Pregadores, logo da igreja e logo de evento são fontes de identidade invioláveis.
- Proíba fusão, redesenho, troca de texto/símbolo, transferência de objetos ou mistura entre camadas.
- Campo de nome vazio = SEM NOME / NÃO ESCREVER NADA.
- Objetos de um auxiliar permanecem na camada do auxiliar e não atravessam para frente do principal.
- Em delta-only, a versão anterior é molde bloqueado; autorize mudança somente no pedido explícito.
- Auxiliares devem abrir visualmente para fora; se ambos olham para o mesmo lado, pode haver flip horizontal integral de um deles sem alterar identidade.

SUBSTITUIÇÃO DE PESSOAS DA REFERÊNCIA — REGRA ABSOLUTA:
- Pessoas humanas presentes na referência são placeholders de layout, não identidades a preservar, salvo ordem explícita do usuário.
- Havendo qualquer pregador enviado, remova TODAS as pessoas da referência que não estejam explicitamente autorizadas.
- O principal enviado deve substituir semanticamente o protagonista da referência, jamais coexistir com ele por engano.
- Preserve função composicional da referência, mas identidade, rosto e pose devem vir das fotos enviadas.
- Proíba mistura facial/corporal entre referência e assets de pregadores.

FIDELIDADE DE POSE E DIREÇÃO:
- Preserve gesto, braços, mãos, microfone, inclinação de cabeça, direção do corpo e olhar.
- Auxiliar voltado predominantemente à direita deve preferencialmente ocupar o lado direito do principal.
- Auxiliar voltado predominantemente à esquerda deve preferencialmente ocupar o lado esquerdo.
- Preserve fisionomia com rigor e evite qualquer alteração cosmética/invenção.

LOGOS — REGRA DE IDENTIDADE:
- NÃO planeje logos como conteúdo gerado.
- Logo principal e logo de evento serão coladas depois pelo compositor determinístico.
- Planeje apenas região, escala e espaço negativo em protected_assets.
- Logos presentes nas referências devem ser removidas, nunca preservadas ou reinterpretadas.

HIERARQUIA DE ATÉ 3 PREGADORES — REGRA ESTRUTURAL:
- A ordem recebida dos pregadores é obrigatória: 1º = PRINCIPAL; 2º = AUXILIAR 1; 3º = AUXILIAR 2.
- PRINCIPAL: maior peso visual e posição mais central da composição.
- AUXILIAR 1 e AUXILIAR 2: secundários, normalmente laterais, podendo ter escala menor.
- Se houver 2 pregadores, não trate os dois como equivalentes se isso tirar a centralidade do PRINCIPAL.
- Se houver 3, o PRINCIPAL deve formar o eixo dominante; os auxiliares equilibram os lados.
- Preserve integralmente a identidade de cada pessoa e associe o nome correto à pessoa correta.

REGRA DE RESERVA — LOGO DE EVENTO × PREGADOR:
A logo de evento será colada deterministicamente depois. Portanto reserve uma área limpa que NÃO atravesse pregadores.
Nunca planeje a região da logo sobre rosto, cabelo, corpo, roupa, mãos, microfone ou instrumento.
Se a região escolhida conflitar, mantenha a região geral e desloque o ponto dentro dela até encontrar espaço livre.
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
const authUser=await requireChurchDesignUser(req);
const churchId=await requireChurchAccess(req,authUser);
const data=req.body||{};if(!(data.references||[]).length&&!data.inspirationStyle)return res.status(400).json({error:"Envie uma referência ou escolha uma direção de inspiração."});
const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
model:"gpt-5.6-terra",reasoning:{effort:"medium"},store:false,input:[{role:"user",content:buildContent(data)}],
text:{format:{type:"json_schema",name:"churchdesign_art_direction",strict:true,schema},verbosity:"low"}
})});
const requestId=r.headers.get("x-request-id")||null;const d=await r.json();if(!r.ok){const e=new Error(d?.error?.message||`OpenAI ${r.status}`);e.requestId=requestId;throw e;}
const text=outputText(d);if(!text)throw new Error("Diretor de Arte não devolveu blueprint.");
let artDirection;try{artDirection=JSON.parse(text)}catch{throw new Error("Blueprint inválido.");}
await logUsage({churchId,userId:authUser.id,operationType:'design-director',model:'gpt-5.6-terra',endpoint:'responses',usage:d.usage,metadata:{...costContextFromData(data),requestId}});
return res.status(200).json({success:true,endpointType:'design-director',artDirection,meta:{model:'gpt-5.6-terra',usage:d.usage||null,requestId,endpoint:'responses'}});
}catch(e){console.error("ChurchDesign Design Director",e);return res.status(e?.statusCode||500).json({error:e.message||"Erro no Diretor de Arte."});}
};
