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
async function logUsage({churchId,userId,operationType,model,endpoint,usage,imageCount=0,metadata={}}){
  try{await serverRest("generation_usage",{method:"POST",body:JSON.stringify([{church_id:churchId,user_id:userId,operation_type:operationType,model,endpoint,input_tokens:usageNumber(usage,'input_tokens','prompt_tokens'),output_tokens:usageNumber(usage,'output_tokens','completion_tokens'),image_count:imageCount,metadata:{...metadata,usage:usage||null}}])})}catch(e){console.error("Usage log",e.message)}
}

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
- logo clara/branca sobre fundo claro ou logo escura/preta sobre fundo escuro sem uma solução de contraste;
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
- LOGOS: nesta etapa, reprove qualquer presença de logo no canvas gerado. A fidelidade das marcas será garantida pelo compositor determinístico depois.
- DELTA ONLY: reprove mudanças não solicitadas na versão-base, inclusive dedos/mãos, pose, rosto, palavras de fundo, logos, cores e efeitos.
- DIREÇÃO: prefira auxiliares abrindo para fora do centro; flip horizontal integral é aceitável sem alteração de identidade.

- SUBSTITUIÇÃO DE REFERÊNCIA — FALHA CRÍTICA: se existem fotos de pregadores enviadas, nenhuma pessoa humana original da arte de referência pode permanecer, salvo autorização explícita. Reprove imediatamente se o protagonista/pastor/modelo da referência continuar visível.
- PRINCIPAL: confirme que a pessoa central/dominante é de fato a FOTO DO PREGADOR PRINCIPAL enviada, e não a pessoa da referência.
- FISIONOMIA: compare rigorosamente cada rosto final às fotos originais. Mudança perceptível de identidade, mistura de traços ou alteração facial significativa é falha crítica.
- POSE: preserve braço levantado/abaixado, gesto, microfone, orientação corporal e direção do olhar. Mudança injustificada de uma pose marcante deve reprovar.
- POSICIONAMENTO DIRECIONAL: auxiliar orientado para a direita deve preferencialmente ficar do lado direito do principal; orientado para a esquerda, do lado esquerdo. Reprove quando a inversão prejudicar claramente a lógica visual e não houver justificativa da referência/instrução.
- CANVAS LOGO-FREE: nesta etapa, a imagem deve conter ZERO logos. Reprove qualquer logo, marca, emblema institucional, símbolo copiado da referência, wordmark ou marca de evento que tenha sobrevivido ou sido inventado.
- NÃO reprove ausência das logos oficiais: elas serão compostas deterministicamente após este Fiscal.
- HIERARQUIA DE PREGADORES: quando houver mais de um, PESSOA 1 é PRINCIPAL e precisa ter prioridade visual e posição mais central que os auxiliares. PESSOA 2 = AUXILIAR 1; PESSOA 3 = AUXILIAR 2.
- Reprove se o principal for tratado como auxiliar periférico enquanto outro pregador ocupa claramente a posição central/dominante sem instrução explícita do usuário.
- Reprove troca de identidade, nome ou papel entre os pregadores.
- Com três pregadores, aceite variações criativas, mas exija que o principal continue sendo o eixo visual predominante.
- REGRA CRÍTICA DE CAMADAS: a logo de evento jamais pode estar desenhada à frente de qualquer parte do pregador. Se houver interseção, o recorte do pregador deve ocluir a logo de evento. Reprove se qualquer fragmento da logo aparecer sobre rosto, cabelo, corpo, roupa, braços ou mãos do pregador.
- Não reprove apenas porque a logo ficou parcialmente escondida atrás do pregador: isso é o comportamento correto quando houver conflito e não existir reposicionamento melhor dentro da zona escolhida.
- Se houver logo de evento, reprove se ela estiver ausente, redesenhada, duplicada, nos cantos extremos, grande além do limite selecionado ou sobreposta à logo principal/rosto/título.\n- Se omitChurchLogo=true, a presença de qualquer logo principal da igreja é falha crítica.\n- Se omitChurchName=true, a presença textual do nome da igreja é falha crítica.

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
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
  try{
    const authUser=await requireChurchDesignUser(req);
    const churchId=await requireChurchAccess(req,authUser);
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
    if(!review.technicalFailure&&(review.human_fidelity<65||review.logo_fidelity<70||review.content_accuracy<75))review.critical_error=true;
    
    await logUsage({churchId,userId:authUser.id,operationType:'quality-inspector',model:'gpt-5.6-sol',endpoint:'responses',usage:d.usage,metadata:{requestId,mode:data.mode||null}});
    return res.status(200).json({success:true,endpointType:'quality-inspector',review,meta:{model:'gpt-5.6-sol',usage:d.usage||null,requestId,endpoint:'responses'}});
  }catch(e){console.error("ChurchDesign quality inspector",e);return res.status(e?.statusCode||500).json({error:e.message||"Erro no fiscal."});}
};
