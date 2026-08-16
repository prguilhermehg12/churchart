const RESPONSES_URL = "https://api.openai.com/v1/responses";

function prompt(data,label,instruction){
  const map=(data.semanticMap||[]).map((l,i)=>`${i+1}. ${l.type}: x ${Math.round(l.x||0)}%, y ${Math.round(l.y||0)}%, w ${Math.round(l.w||0)}%, h ${Math.round(l.h||0)}%`).join("\n");
  const refs=(data.references||[]).map((r,i)=>`Referência ${i+1}: ${r.note||'Use como inspiração visual geral.'}`).join("\n");
  return `Você é diretor de arte. Crie SOMENTE A BASE VISUAL de um cartaz profissional de igreja.

NÃO DESENHE PESSOAS. NÃO ESCREVA TEXTO. NÃO DESENHE LOGOS.
NÃO ESCREVA MARCAS INTERNAS como "Logo 1", "reserva", "pregador", "título", nomes de camadas ou rótulos de configuração.

O aplicativo aplicará depois, de forma exata, pregador, logo, textos, fontes e PNGs protegidos.
Crie apenas fundos, texturas, luz, profundidade, grafismos e espaços adequados.

Se hasLogo=${!!data?.church?.hasLogo}, NÃO escreva o nome da igreja.

INSTRUÇÕES DAS REFERÊNCIAS:
${refs||'Use a referência principal como direção visual.'}

MAPA DE ÁREAS RESERVADAS:
${map}

ELEMENTOS VISUAIS DESEJADOS: ${(data.visualElements||[]).join(', ')||'nenhum específico'}
DIREÇÃO GERAL: ${data.instruction||'nenhuma'}
INSTRUÇÕES FINAIS: ${data.finalInstruction||'nenhuma'}
EFEITOS SOLICITADOS: ${(data.effects||[]).map(e=>`${e.id} em ${e.target}`).join(', ')||'nenhum'}
VARIAÇÃO ${label}: ${instruction}

A saída deve ser somente a base gráfica final, sem textos, sem pessoas, sem logos e sem rótulos de configuração.`;
}

function inputContent(data,text){
  const c=[{type:'input_text',text}];
  const refs=Array.isArray(data.references)&&data.references.length?data.references:[data.reference?{image:data.reference,note:''}:null].filter(Boolean);
  for(const r of refs.slice(0,3)){
    if(r?.image&&String(r.image).startsWith('data:image/'))c.push({type:'input_image',image_url:r.image,detail:'high'});
  }
  return c;
}

async function callImageModel({data,label,instruction,model,inputFidelity}) {
  const size=data.format==='wide'?'1536x1024':'1024x1536';

  const imageTool={
    type:'image_generation',
    model,
    action:'edit',
    quality:'medium',
    size,
    output_format:'png'
  };

  // input_fidelity is currently supported by gpt-image-1, but not by gpt-image-2.
  if(inputFidelity){
    imageTool.input_fidelity=inputFidelity;
  }

  const r=await fetch(RESPONSES_URL,{
    method:'POST',
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:'gpt-5-mini',
      input:[{
        role:'user',
        content:inputContent(data,prompt(data,label,instruction))
      }],
      tools:[imageTool],
      tool_choice:'required'
    })
  });

  const d=await r.json();

  if(!r.ok){
    const message=d?.error?.message||`Erro OpenAI ${r.status}`;
    const err=new Error(message);
    err.status=r.status;
    err.openaiBody=d;
    throw err;
  }

  const call=(d.output||[]).find(
    x=>x.type==='image_generation_call'&&x.result
  );

  if(!call?.result){
    throw new Error(`O modelo ${model} não retornou a base visual.`);
  }

  return{
    label,
    dataUrl:`data:image/png;base64,${call.result}`,
    modelUsed:model
  };
}

function isRetryableModelError(error){
  const msg=String(error?.message||'').toLowerCase();

  return (
    msg.includes('does not support') ||
    msg.includes('unsupported') ||
    msg.includes('unknown parameter') ||
    msg.includes('invalid parameter') ||
    msg.includes('model') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('overloaded') ||
    error?.status===404 ||
    error?.status===400 ||
    error?.status===429 ||
    (error?.status>=500 && error?.status<=599)
  );
}


async function directImagesFallback(data,label,instruction){
  const size=data.format==='wide'?'1536x1024':'1024x1536';
  const text=prompt(data,label,instruction);
  const r=await fetch('https://api.openai.com/v1/images/generations',{
    method:'POST',
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:'gpt-image-1',prompt:text,size,quality:'medium',output_format:'png'})
  });
  const d=await r.json();
  if(!r.ok)throw new Error(d?.error?.message||`Fallback direto ${r.status}`);
  const image=d?.data?.[0]?.b64_json;
  if(!image)throw new Error('Fallback direto não retornou imagem.');
  return{label,dataUrl:`data:image/png;base64,${image}`,modelUsed:'gpt-image-1-direct',fallbackUsed:true,attempt:99};
}

async function gen(data,label,instruction){
  const attempts=[
    {
      model:'gpt-image-2',
      inputFidelity:null,
      description:'GPT Image 2'
    },
    {
      model:'gpt-image-1',
      inputFidelity:'high',
      description:'GPT Image 1 com alta fidelidade'
    },
    {
      model:'gpt-image-1',
      inputFidelity:null,
      description:'GPT Image 1 compatibilidade'
    }
  ];

  const failures=[];

  for(let i=0;i<attempts.length;i++){
    const attempt=attempts[i];

    try{
      const result=await callImageModel({
        data,
        label,
        instruction,
        model:attempt.model,
        inputFidelity:attempt.inputFidelity
      });

      return{
        ...result,
        fallbackUsed:i>0,
        attempt:i+1
      };

    }catch(error){
      failures.push({
        model:attempt.model,
        message:error?.message||'Erro desconhecido'
      });

      console.warn(
        `[ChurchDesign] Falha em ${attempt.description}:`,
        error?.message
      );

      if(i===attempts.length-1 || !isRetryableModelError(error)){
        try{
          return await directImagesFallback(data,label,instruction);
        }catch(directError){
          const summary=failures.map(f=>`${f.model}: ${f.message}`).join(' | ');
          throw new Error(`Todos os modelos de geração falharam. ${summary} | fallback direto: ${directError.message}`);
        }
      }
    }
  }

  throw new Error('Nenhum modelo de geração ficou disponível.');
}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Método não permitido.'});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:'OPENAI_API_KEY não configurada.'});
  try{
    const data=req.body||{};
    if(!data.reference&&!(data.references||[]).length)return res.status(400).json({error:'Selecione pelo menos uma arte de referência.'});
    const v=data.variantInstructions||{};
    const specs=[
      ['Fiel à referência',v.faithful||'Preserve rigorosamente composição e linguagem.'],
      ['Equilibrada',v.balanced||'Preserve o DNA, melhorando equilíbrio.'],
      ['Mais criativa',v.creative||'Maior liberdade visual, preservando áreas reservadas.']
    ];
    const images=await Promise.all(specs.map(x=>gen(data,x[0],x[1])));
    return res.status(200).json({success:true,images});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:e.message||'Erro ao gerar.'});
  }
};
