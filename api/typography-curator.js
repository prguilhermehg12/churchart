module.exports.config={maxDuration:60};
const RESPONSES_URL="https://api.openai.com/v1/responses";
const roleSchema={type:"object",additionalProperties:false,required:["mode","confidence","selected_font_id","selected_font_label","reason","box","uppercase","align","color","outline","outline_color","shadow","size_scale"],properties:{mode:{type:"string",enum:["ai","system","hybrid"]},confidence:{type:"number"},selected_font_id:{type:"string"},selected_font_label:{type:"string"},reason:{type:"string"},box:{type:"object",additionalProperties:false,required:["x","y","w","h"],properties:{x:{type:"number"},y:{type:"number"},w:{type:"number"},h:{type:"number"}}},uppercase:{type:"boolean"},align:{type:"string",enum:["left","center","right"]},color:{type:"string"},outline:{type:"boolean"},outline_color:{type:"string"},shadow:{type:"boolean"},size_scale:{type:"number"}}};
const schema={type:"object",additionalProperties:false,required:["summary","roles"],properties:{summary:{type:"string"},roles:{type:"object",additionalProperties:false,required:["title","subtitle","date","time","address","pastorNames"],properties:{title:roleSchema,subtitle:roleSchema,date:roleSchema,time:roleSchema,address:roleSchema,pastorNames:roleSchema}}}};
function content(data){
 const c=[{type:"input_text",text:`Você é o CURADOR TIPOGRÁFICO do ChurchDesign. Sua missão é decidir quando uma tipografia real/editável melhora a peça e quando destruiria a linguagem visual.
REGRA PRINCIPAL: fidelidade visual > editabilidade. Em dúvida use mode=ai.
TITLE: só system/hybrid se houver correspondência visual realmente forte, composição simples e nenhuma integração difícil com foto, perspectiva, lettering ou distorção. Caso contrário AI.
SUBTITLE/DATE/TIME/ADDRESS/PASTORNAMES podem usar system/hybrid com mais frequência, mas apenas se a fonte candidata combinar com a referência.
confidence precisa refletir confiança REAL. SYSTEM/HYBRID só deve ser usado quando confidence >= 0.88.
Os boxes são normalizados 0..1 e precisam ficar dentro da safe area 0.12..0.88.
Conteúdo: ${JSON.stringify(data.requiredContent||{})}
Público: ${data.audience||"não especificado"}
Estilo: ${data.designStyle||"não especificado"}
Instrução: ${data.instruction||""}`}];
 for(const r of (data.references||[]).slice(0,2))if(r?.image)c.push({type:"input_text",text:"REFERÊNCIA VISUAL:"},{type:"input_image",image_url:r.image,detail:"high"});
 for(const f of (data.fontCandidates||[]).slice(0,13)){c.push({type:"input_text",text:`CANDIDATA ${f.id}: ${f.label}`},{type:"input_image",image_url:f.preview,detail:"low"});}
 return c;
}
function out(d){if(d.output_text)return d.output_text;for(const i of d.output||[])if(i.type==="message")for(const p of i.content||[])if(p.type==="output_text")return p.text;return"";}
module.exports=async function handler(req,res){if(req.method!=="POST")return res.status(405).json({error:"Método não permitido."});try{const data=req.body||{};const r=await fetch(RESPONSES_URL,{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-terra",store:false,input:[{role:"user",content:content(data)}],text:{format:{type:"json_schema",name:"churchdesign_typography_plan",strict:true,schema},verbosity:"low"}})});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||`OpenAI ${r.status}`);let plan;try{plan=JSON.parse(out(d))}catch{throw new Error("Plano tipográfico inválido.");}
 // Hard conservative gate: never system/hybrid below .88. Title below .92 becomes AI.
 for(const [role,p] of Object.entries(plan.roles||{})){if(Number(p.confidence||0)<.88){p.mode="ai";}if(role==="title"&&Number(p.confidence||0)<.92){p.mode="ai";}if(p.mode==="ai"){p.selected_font_id="";p.selected_font_label="";}}
 return res.status(200).json({success:true,typographyPlan:plan,meta:{model:'gpt-5.6-terra',usage:d.usage||null}});}catch(e){console.error("ChurchDesign typography curator",e);return res.status(500).json({error:e.message||"Erro no Curador Tipográfico."});}};
