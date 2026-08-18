module.exports.config={maxDuration:60};
const RESPONSES_URL="https://api.openai.com/v1/responses";
const schema={type:"object",additionalProperties:false,required:["approved","critical_error","score","human_fidelity","logo_fidelity","content_accuracy","reference_coherence","gross_errors","correction_prompt"],properties:{
approved:{type:"boolean"},critical_error:{type:"boolean"},score:{type:"number"},
human_fidelity:{type:"number"},logo_fidelity:{type:"number"},content_accuracy:{type:"number"},reference_coherence:{type:"number"},
gross_errors:{type:"array",items:{type:"string"}},correction_prompt:{type:"string"}
}};
function content(data){
  const c=[{type:"input_text",text:`Você é o FISCAL DE QUALIDADE do ChurchDesign. Você NÃO cria arte. Você decide se uma arte pode ser entregue a um cliente que pagará créditos.

PRINCÍPIO: complexidade quando possível; coerência sempre. Prefira uma solução visual simples e correta a uma sofisticada com erros.

ERROS CRÍTICOS que reprovam:
- rosto/pessoa perceptivelmente diferente da foto original;
- pessoa obrigatória ausente;
- logo deformada, redesenhada ou trocada;
- título/data/horário/endereço obrigatórios errados, inventados ou ausentes;
- erro grosseiro de posicionamento quando o usuário especificou uma região;
- arte quebrada, ilegível ou com artefatos severos;\n- qualquer texto, logo, rosto, data, horário, endereço ou informação essencial cortado, encostado demais na borda ou parcialmente fora do canvas.

Se público-alvo ou estilo estiverem especificados, verifique se a peça é coerente com eles, mas não reprove por diferenças criativas pequenas.
Se não estiverem especificados, ignore esse critério.
Erros criativos menores NÃO devem reprovar. Porém, violação de área segura de conteúdo essencial deve reprovar.

COMPOSIÇÃO ADAPTATIVA:
- Verifique se a arte usa apenas as pessoas realmente fornecidas.
- Se a referência tinha mais pessoas que os assets fornecidos, a arte deve ter sido recomposta para a quantidade real.
- Reprove silhuetas, sombras humanas, espaços reservados ou pessoas inventadas usados apenas para imitar posições de pessoas ausentes na referência.
- A referência deve ser preservada como linguagem visual, não como molde rígido.

Conteúdo obrigatório: ${JSON.stringify(data.requiredContent||{})}
Público-alvo escolhido: ${data.audience||"não especificado"}
Estilo escolhido: ${data.designStyle||"não especificado"}
Mapa/posições: ${JSON.stringify(data.semanticMap||[])}
Instrução: ${data.userInstruction||""}
Instrução final: ${data.finalInstruction||""}

Avalie de forma conservadora. Se reprovar, escreva correction_prompt curto e operacional. Se a complexidade estiver causando erro, mande SIMPLIFICAR a área problemática.`}];
  for(const r of (data.references||[]).slice(0,2))if(r?.image)c.push({type:"input_text",text:"REFERÊNCIA DE DESIGN:"},{type:"input_image",image_url:r.image,detail:"high"});
  if(data.assets?.pastor?.image)c.push({type:"input_text",text:"FOTO ORIGINAL DA PESSOA:"},{type:"input_image",image_url:data.assets.pastor.image,detail:"high"});
  if(data.assets?.logo?.image)c.push({type:"input_text",text:"LOGO ORIGINAL:"},{type:"input_image",image_url:data.assets.logo.image,detail:"high"});
  c.push({type:"input_text",text:"ARTE GERADA A SER FISCALIZADA:"},{type:"input_image",image_url:data.generatedImage,detail:"high"});
  return c;
}
function out(d){if(d.output_text)return d.output_text;for(const i of d.output||[])if(i.type==="message")for(const p of i.content||[])if(p.type==="output_text")return p.text;return"";}
module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  try{
    const data=req.body||{};
    const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
      model:"gpt-5.6-sol",reasoning:{effort:"high"},store:false,input:[{role:"user",content:content(data)}],
      text:{format:{type:"json_schema",name:"churchdesign_quality_review",strict:true,schema},verbosity:"low"}
    })});
    const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);
    const text=out(d);let review;try{review=JSON.parse(text)}catch{throw new Error("Fiscal devolveu resposta inválida.");}
    // hard gates
    if(review.human_fidelity<82||review.logo_fidelity<88||review.content_accuracy<90)review.approved=false;
    if(review.human_fidelity<65||review.logo_fidelity<70||review.content_accuracy<75)review.critical_error=true;
    return res.status(200).json({success:true,review});
  }catch(e){console.error("ChurchDesign quality inspector",e);return res.status(500).json({error:e.message||"Erro no fiscal."});}
};
