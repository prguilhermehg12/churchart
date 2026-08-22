// ChurchDesign V0.31.3 — semantic occupancy analyzer for post-art logo placement
module.exports.config={maxDuration:60};

const RESPONSES_URL="https://api.openai.com/v1/responses";

const REGION_TYPES=[
  "person","face","hand","microphone","instrument",
  "text_title","text_subtitle","text_date","text_address","text_other",
  "graphic_focus"
];

const schema={
  type:"object",
  additionalProperties:false,
  required:["regions","tone_grid","notes"],
  properties:{
    regions:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        required:["type","x0","y0","x1","y1","confidence"],
        properties:{
          type:{type:"string",enum:REGION_TYPES},
          x0:{type:"number"},y0:{type:"number"},x1:{type:"number"},y1:{type:"number"},
          confidence:{type:"number"}
        }
      }
    },
    tone_grid:{
      type:"object",
      additionalProperties:false,
      required:["cols","rows","values"],
      properties:{
        cols:{type:"number"},
        rows:{type:"number"},
        values:{type:"array",items:{type:"number"}}
      }
    },
    notes:{type:"array",items:{type:"string"}}
  }
};

function outputText(d){
  if(typeof d.output_text==="string")return d.output_text;
  for(const item of d.output||[])if(item.type==="message")for(const part of item.content||[])if(part.type==="output_text"&&part.text)return part.text;
  return "";
}
function clamp(n,min,max){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min}
function normalizeRegion(r){
  const x0=clamp(Math.min(Number(r.x0)||0,Number(r.x1)||0),0,1000);
  const x1=clamp(Math.max(Number(r.x0)||0,Number(r.x1)||0),0,1000);
  const y0=clamp(Math.min(Number(r.y0)||0,Number(r.y1)||0),0,1000);
  const y1=clamp(Math.max(Number(r.y0)||0,Number(r.y1)||0),0,1000);
  return{type:REGION_TYPES.includes(r.type)?r.type:"graphic_focus",x0,y0,x1,y1,confidence:clamp(r.confidence,0,1)};
}
function normalizeGrid(g={}){
  const cols=8,rows=10,expected=cols*rows;
  const input=Array.isArray(g.values)?g.values:[];
  const values=Array.from({length:expected},(_,i)=>clamp(input[i]??50,0,100));
  return{cols,rows,values};
}

module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});
  if(!process.env.OPENAI_API_KEY)return res.status(500).json({error:"OPENAI_API_KEY não configurada."});
  try{
    const data=req.body||{};
    const image=data.image;
    if(!image||!String(image).startsWith("data:image/"))return res.status(400).json({error:"Envie a base plate como data:image/... ."});

    const prompt=`Você é o ANALISADOR DE OCUPAÇÃO do ChurchDesign.
Você NÃO cria arte e NÃO decide onde logos devem ficar.

Analise a imagem final LOGO-FREE e devolva somente o mapa semântico necessário para um solver determinístico.

COORDENADAS:
- Todas as caixas usam escala 0..1000.
- x0,y0 = canto superior esquerdo; x1,y1 = canto inferior direito.
- Cubra a extensão VISÍVEL inteira do elemento.
- Quando houver 3 pessoas, devolva 3 regiões person separadas.
- Detecte faces e mãos separadamente quando visíveis.
- Detecte microfone/instrumento quando existirem.
- Detecte blocos de texto por função visual: title, subtitle, date, address, other.
- graphic_focus = elemento gráfico importante que não deve ser coberto.
- NÃO invente elementos não visíveis.
- NÃO retorne posição de logo.

TONE GRID:
- Gere uma grade fixa 8 colunas x 10 linhas, em ordem linha-a-linha do topo esquerdo para baixo direito.
- Cada valor vai de 0 (muito escuro) a 100 (muito claro).
- Considere a luminância visual do fundo naquela célula, mesmo que haja textura.
- Exatamente 80 valores.

Objetivo: permitir que um programa coloque logos sem cobrir pessoa, rosto, mão, microfone, instrumento ou texto.`;

    const model=process.env.LOGO_ANALYZER_MODEL||"gpt-5.6-terra";
    const r=await fetch(RESPONSES_URL,{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model,reasoning:{effort:"low"},store:false,
        input:[{role:"user",content:[
          {type:"input_text",text:prompt},
          {type:"input_image",image_url:image,detail:"high"}
        ]}],
        text:{format:{type:"json_schema",name:"churchdesign_logo_occupancy",strict:true,schema},verbosity:"low"}
      })
    });
    const requestId=r.headers.get("x-request-id")||null;
    const d=await r.json();
    if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);
    const text=outputText(d);
    let parsed;
    try{parsed=JSON.parse(text)}catch{throw new Error("Logo Analyzer devolveu JSON inválido.");}

    const occupancy={
      version:1,
      regions:(parsed.regions||[]).map(normalizeRegion).filter(x=>x.x1>x.x0&&x.y1>x.y0&&x.confidence>=.25),
      toneGrid:normalizeGrid(parsed.tone_grid),
      notes:Array.isArray(parsed.notes)?parsed.notes.slice(0,20):[]
    };

    return res.status(200).json({
      success:true,endpointType:"logo-analyzer",occupancy,
      meta:{model,usage:d.usage||null,requestId,endpoint:"responses"}
    });
  }catch(e){
    console.error("ChurchDesign Logo Analyzer",e);
    return res.status(500).json({error:e.message||"Erro no analisador de ocupação."});
  }
};
