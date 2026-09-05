// CHURCHDESIGN — church-data v0.48.0
// ChurchDesign V0.48.0 — multi-church, membership validated, web/mobile-ready
const BUCKET = "churchart-assets";

function envCfg(){
  const raw=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const anon=process.env.SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!raw||!anon||!secret)throw Object.assign(new Error("SUPABASE_URL, SUPABASE_ANON_KEY ou SUPABASE_SECRET_KEY não configuradas."),{statusCode:500});
  return {url:raw,anon,secret};
}

async function requireChurchDesignUser(req){
  const c=envCfg();
  const authorization=String(req.headers.authorization||"");
  if(!/^Bearer\s+\S+/i.test(authorization))throw Object.assign(new Error("Autenticação obrigatória."),{statusCode:401});
  const r=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.anon,Authorization:authorization}});
  const user=await r.json().catch(()=>null);
  if(!r.ok||!user?.id)throw Object.assign(new Error("Sessão inválida ou expirada."),{statusCode:401});
  return user;
}

async function serviceRest(path,opt={}){
  const c=envCfg();
  const r=await fetch(`${c.url}/rest/v1/${path}`,{
    ...opt,
    headers:{apikey:c.secret,Authorization:`Bearer ${c.secret}`,"Content-Type":"application/json",...(opt.headers||{})}
  });
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw Object.assign(new Error(data?.message||data?.error||data?.hint||`Supabase REST ${r.status}`),{statusCode:r.status>=400&&r.status<500?r.status:500});
  return data;
}


async function serviceRpc(name,body={}){
  const c=envCfg();
  const r=await fetch(`${c.url}/rest/v1/rpc/${encodeURIComponent(name)}`,{
    method:"POST",
    headers:{apikey:c.secret,Authorization:`Bearer ${c.secret}`,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw Object.assign(new Error(data?.message||data?.error||data?.hint||`RPC ${name} ${r.status}`),{statusCode:r.status>=400&&r.status<500?r.status:500});
  return data;
}

async function userRpc(req,name,body={}){
  const c=envCfg();
  const authorization=String(req.headers.authorization||"");
  const r=await fetch(`${c.url}/rest/v1/rpc/${encodeURIComponent(name)}`,{
    method:"POST",
    headers:{apikey:c.anon,Authorization:authorization,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw Object.assign(new Error(data?.message||data?.error||data?.hint||`RPC ${name} ${r.status}`),{statusCode:r.status===401?401:r.status===403?403:400});
  return data;
}

function requestedChurchId(req){return String(req.headers['x-church-id']||req.query?.church_id||req.body?.church_id||'').trim()}
async function requireMembership(user,churchId,{owner=false}={}){
  if(!churchId)throw Object.assign(new Error("Igreja ativa não informada."),{statusCode:400});
  const rows=await serviceRest(`church_members?church_id=eq.${encodeURIComponent(churchId)}&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=role,status`);
  const membership=rows?.[0];
  if(!membership)throw Object.assign(new Error("Você não possui acesso a esta igreja."),{statusCode:403});
  if(owner&&membership.role!=="owner")throw Object.assign(new Error("Somente o responsável da igreja pode realizar esta ação."),{statusCode:403});
  return membership;
}


async function listAuthUsers(){
  const c=envCfg();
  const r=await fetch(`${c.url}/auth/v1/admin/users?page=1&per_page=1000`,{
    headers:{apikey:c.secret,Authorization:`Bearer ${c.secret}`}
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok)return[];
  return Array.isArray(d?.users)?d.users:Array.isArray(d)?d:[];
}
function monthStartISO(){
  const d=new Date();
  return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)).toISOString();
}
async function requireAppAdmin(req,user){
  const ok=await userRpc(req,"is_app_admin",{});
  if(!ok)throw Object.assign(new Error("Acesso administrativo negado."),{statusCode:403});
  return user;
}




async function generationCreditPrice(artType,format){
  const type=String(artType||"Arte base"),fmt=String(format||"");
  const rows=await serviceRest(`generation_credit_prices?active=eq.true&select=art_type,format,credits,priority&order=priority.desc`);
  const exact=(rows||[]).find(x=>x.art_type===type&&String(x.format||"")===fmt);
  const byType=(rows||[]).find(x=>x.art_type===type&&!x.format);
  const fallback=(rows||[]).find(x=>x.art_type==="*"&&!x.format);
  return Math.max(0,Number((exact||byType||fallback)?.credits)||0);
}
async function persistAppError({churchId,userId,operationId=null,category="processing",stage="app",severity="error",userMessage="",technicalMessage="",stack="",metadata={}}){
  try{
    await serviceRest("app_error_logs",{method:"POST",body:JSON.stringify([{
      church_id:churchId||null,user_id:userId||null,operation_id:operationId||null,category:String(category||"processing").slice(0,80),
      stage:String(stage||"app").slice(0,120),severity:String(severity||"error").slice(0,30),user_message:String(userMessage||"").slice(0,2000),
      technical_message:String(technicalMessage||"").slice(0,12000),stack:String(stack||"").slice(0,16000),metadata:metadata||{}
    }])});
  }catch(e){console.error("[ChurchDesign] app_error_logs",e.message)}
}

const HISTORY_COST_RATES={
  "gpt-5.6-sol":{kind:"text",input:5,cached:.5,output:30},
  "gpt-5.6":{kind:"text",input:5,cached:.5,output:30},
  "gpt-5.6-terra":{kind:"text",input:2,cached:.2,output:12},
  "gpt-5.6-luna":{kind:"text",input:.2,cached:.02,output:1.2},
  "gpt-image-2":{kind:"image",text_input:5,text_cached:1.25,text_output:10,image_input:8,image_cached:2,image_output:30}
};
function historyNum(obj,...paths){for(const path of paths){let v=obj;for(const k of path.split("."))v=v?.[k];if(Number.isFinite(Number(v)))return Number(v)}return 0}
function estimateHistoryCost(row){
  const persisted=Number(row?.cost_usd)||0;if(persisted>0)return persisted;
  const usage=row?.metadata?.usage||null;if(!usage)return 0;
  const r=HISTORY_COST_RATES[row?.model]||HISTORY_COST_RATES["gpt-5.6-sol"];
  if(r.kind==="text"){
    const input=historyNum(usage,"input_tokens","prompt_tokens"),output=historyNum(usage,"output_tokens","completion_tokens"),cached=historyNum(usage,"input_tokens_details.cached_tokens","prompt_tokens_details.cached_tokens");
    return ((Math.max(0,input-cached)*r.input)+(cached*r.cached)+(output*r.output))/1e6;
  }
  const ti=historyNum(usage,"input_tokens_details.text_tokens","input_details.text_tokens","text_input_tokens"),ii=historyNum(usage,"input_tokens_details.image_tokens","input_details.image_tokens","image_input_tokens"),ci=historyNum(usage,"input_tokens_details.cached_tokens","input_details.cached_tokens"),to=historyNum(usage,"output_tokens_details.text_tokens","output_details.text_tokens","text_output_tokens"),io=historyNum(usage,"output_tokens_details.image_tokens","output_details.image_tokens","image_output_tokens"),input=historyNum(usage,"input_tokens","prompt_tokens"),output=historyNum(usage,"output_tokens","completion_tokens");
  if(ti||ii||to||io){const imageCached=Math.min(ii,ci),textCached=Math.max(0,ci-imageCached);return ((Math.max(0,ti-textCached)*r.text_input)+(textCached*r.text_cached)+(Math.max(0,ii-imageCached)*r.image_input)+(imageCached*r.image_cached)+(to*r.text_output)+(io*r.image_output))/1e6}
  return ((input*r.image_input)+(output*r.image_output))/1e6;
}
function historyArtType(row){
  const m=row?.metadata||{},explicit=String(m.art_type||"").trim();if(explicit)return explicit;
  const label=String(m.label||m.variant_label||"").toLowerCase(),format=String(m.format||"").toLowerCase();
  if(/fundo|background/.test(label+format))return"Fundo";
  if(/modo livre|free/.test(label+format))return"Modo Livre";
  if(/youtube/.test(label+format))return"YouTube";
  if(/tel[aã]o|screen/.test(label+format))return"Telão";
  if(/stor(y|ies)|9:16/.test(label+format))return"Stories";
  if(/corre[cç]/.test(label))return"Correção";
  if(/derivada/.test(label)||m.mode==="adaptation")return"Derivada";
  return"Arte base";
}
function legacyProjectName(row){
  const m=row?.metadata||{},name=String(m.project_name||"").trim();if(name)return name;
  const label=String(m.label||"").trim();
  return /^(principal|varia[cç][aã]o\s*\d+)$/i.test(label)?"Projeto legado":(label||"Projeto legado");
}

function cleanInValue(v){return String(v||"").replace(/[(),\s]/g,"")}
function inList(values=[]){return values.map(cleanInValue).filter(Boolean).join(",")}

function shareToken(){
  return `${crypto.randomUUID().replace(/-/g,"")}${crypto.randomUUID().replace(/-/g,"")}`;
}
function shareExpiryISO(hours=168){
  const safe=[24,72,168,720].includes(Number(hours))?Number(hours):168;
  return new Date(Date.now()+safe*60*60*1000).toISOString();
}


function galleryItemParentId(item){
  return String(item?.parentArtworkId||item?.recipe?.parentArtworkId||"");
}
function galleryItemNaturalRoot(item,byId){
  let cur=item,seen=new Set();
  while(cur){
    const id=String(cur?.galleryId||"");
    if(!id||seen.has(id))break;
    seen.add(id);
    const pid=galleryItemParentId(cur);
    if(pid&&byId.has(pid)){cur=byId.get(pid);continue}
    break;
  }
  return String(cur?.galleryId||item?.galleryId||"");
}
function galleryItemMergeGroup(item,byId){
  return String(item?.recipe?.mergeGroupId||item?.mergeGroupId||galleryItemNaturalRoot(item,byId));
}
function galleryItemTime(item){
  return new Date(item?.createdAt||item?.recipe?.createdAt||item?.generationCreatedAt||0).getTime()||0;
}
async function latestGalleryMap(churchId){
  const rows=await serviceRest(`church_generations?church_id=eq.${encodeURIComponent(churchId)}&select=id,images,created_at&order=created_at.desc&limit=300`);
  const map=new Map();
  for(const g of (rows||[])){
    for(const im of (Array.isArray(g.images)?g.images:[])){
      const gid=String(im?.galleryId||"");
      if(gid&&!map.has(gid))map.set(gid,{...im,generationId:g.id,generationCreatedAt:g.created_at});
    }
  }
  return map;
}
function isFinalMother(item){
  const r=item?.recipe||{};
  const parent=item?.parentArtworkId||r.parentArtworkId||null;
  return !!item?.galleryId && !parent && r.finalized!==false && !String(item?.kind||r.kind||"").toLowerCase().includes("rascunho");
}
function isFinalDerivative(item,parentGalleryId){
  const r=item?.recipe||{};
  const parent=String(item?.parentArtworkId||r.parentArtworkId||"");
  const kind=String(item?.kind||r.kind||"").toLowerCase();
  return parent===String(parentGalleryId||"") && r.finalized!==false && kind.includes("derivada") && !kind.includes("rascunho");
}
async function publishFeedPostForItem(churchId,item,fallbackAuthorId,{force=false}={}){
  if(!isFinalMother(item))return null;
  const profile=(await serviceRest(`church_profile?id=eq.${encodeURIComponent(churchId)}&select=feed_publish_all`))?.[0];
  if(!force&&!profile?.feed_publish_all)return null;
  const existing=(await serviceRest(`feed_posts?church_id=eq.${encodeURIComponent(churchId)}&gallery_id=eq.${encodeURIComponent(item.galleryId)}&select=*&limit=1`))?.[0];
  const r=item.recipe||{};
  const authorId=existing?.author_user_id||r.createdByUserId||fallbackAuthorId;
  const row={
    church_id:churchId,gallery_id:String(item.galleryId),generation_id:item.generationId||null,
    author_user_id:authorId,image_url:item.url||item.dataUrl||null,label:item.label||r.projectName||"Arte",
    format:item.format||r.format||item.target?.id||"feed",target:item.target||r.target||{},
    meta:{projectName:r.projectName||item.projectName||"",downloadedAt:r.downloadedAt||item.downloadedAt||null},
    active:true,updated_at:new Date().toISOString()
  };
  const saved=await serviceRest("feed_posts?on_conflict=church_id,gallery_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});
  return saved?.[0]||existing||null;
}
async function feedIdentityMaps(posts=[]){
  const churchIds=[...new Set(posts.map(p=>p.church_id).filter(Boolean))];
  const authorIds=[...new Set(posts.map(p=>p.author_user_id).filter(Boolean))];
  const [churches,profiles,authUsers]=await Promise.all([
    churchIds.length?serviceRest(`church_profile?id=in.(${inList(churchIds)})&select=id,name,label,profile_logo_url`):[],
    authorIds.length?serviceRest(`user_profiles?user_id=in.(${inList(authorIds)})&select=user_id,name`):[],
    listAuthUsers()
  ]);
  return {
    churchById:new Map((churches||[]).map(x=>[x.id,x])),
    profileById:new Map((profiles||[]).map(x=>[x.user_id,x])),
    authById:new Map((authUsers||[]).map(x=>[x.id,x]))
  };
}
async function enrichFeedPosts(posts,viewerId){
  const ids=posts.map(p=>p.id).filter(Boolean);
  const likes=ids.length?await serviceRest(`feed_likes?post_id=in.(${inList(ids)})&select=post_id,user_id`):[];
  const likeCounts=new Map(),liked=new Set();
  for(const l of (likes||[])){
    likeCounts.set(l.post_id,(likeCounts.get(l.post_id)||0)+1);
    if(String(l.user_id)===String(viewerId))liked.add(l.post_id);
  }
  const maps=await feedIdentityMaps(posts);
  const galleryByChurch=new Map();
  for(const churchId of [...new Set(posts.map(p=>p.church_id).filter(Boolean))])galleryByChurch.set(churchId,await latestGalleryMap(churchId));
  return posts.map(p=>{
    const ch=maps.churchById.get(p.church_id)||{},up=maps.profileById.get(p.author_user_id)||{},au=maps.authById.get(p.author_user_id)||{};
    const gm=galleryByChurch.get(p.church_id)||new Map();
    let derivativeCount=0;
    for(const im of gm.values())if(isFinalDerivative(im,p.gallery_id))derivativeCount++;
    return {...p,church_name:ch.name||"",church_label:ch.label||ch.name||"Igreja",profile_logo_url:ch.profile_logo_url||null,
      author_name:up.name||au.user_metadata?.name||au.user_metadata?.full_name||"",author_email:au.email||"",
      like_count:likeCounts.get(p.id)||0,liked_by_me:liked.has(p.id),derivative_count:derivativeCount};
  });
}

function safeName(name="file"){return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,100)||"file"}
function encodeObjectPath(path){return String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/")}
function storageObjectUrl(path){const c=envCfg();return `${c.url}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeObjectPath(path)}`}
function storagePublicUrl(path){const c=envCfg();return `${c.url}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodeObjectPath(path)}`}
async function uploadDataUrl(dataUrl,path,mime){
  const c=envCfg();
  if(typeof dataUrl!=="string"||!dataUrl.includes(","))throw new Error("Arquivo inválido.");
  const base64=dataUrl.split(",")[1];if(!base64)throw new Error("Arquivo sem conteúdo.");
  const r=await fetch(storageObjectUrl(path),{method:"POST",headers:{apikey:c.secret,Authorization:`Bearer ${c.secret}`,"Content-Type":mime||"application/octet-stream","x-upsert":"true"},body:Buffer.from(base64,"base64")});
  const text=await r.text();if(!r.ok)throw new Error(`Falha no Storage: ${text.slice(0,240)}`);
  return storagePublicUrl(path);
}

module.exports=async function handler(req,res){
  try{
    const action=String(req.query.action||"");
    const authUser=await requireChurchDesignUser(req);
    envCfg();

    // Account-level actions: no active church required yet.

    // Platform-admin actions live here intentionally, so web/iOS/Android share one stable authenticated API route.


    if(action==="generation-operation-start"&&req.method==="POST"){
      const b=req.body||{},operationId=String(b.operationId||"").trim(),artType=String(b.artType||"Arte base").trim(),format=String(b.format||"").trim();
      if(!operationId)throw Object.assign(new Error("Operação de geração ausente."),{statusCode:400});
      await requireMembership(authUser,churchId);
      const isAdmin=!!(await userRpc(req,"is_app_admin",{}).catch(()=>false));
      const credits=isAdmin?0:await generationCreditPrice(artType,format);
      let debit={balance:null,debited:0};
      if(credits>0){
        debit=await userRpc(req,"reserve_generation_credits",{p_church_id:churchId,p_operation_id:operationId,p_credits:credits,p_metadata:{art_type:artType,format,project_name:String(b.projectName||""),client_metadata:b.metadata||{}}});
      }
      const existing=(await serviceRest(`generation_operations?operation_id=eq.${encodeURIComponent(operationId)}&select=*&limit=1`))?.[0];
      if(!existing)await serviceRest("generation_operations",{method:"POST",body:JSON.stringify([{operation_id:operationId,church_id:churchId,user_id:authUser.id,art_type:artType,format,project_name:String(b.projectName||""),credits_reserved:credits,status:"processing",metadata:b.metadata||{}}])});
      return res.json({ok:true,operationId,credits,balance:debit?.balance??null});
    }

    if(action==="generation-operation-complete"&&req.method==="POST"){
      const b=req.body||{},operationId=String(b.operationId||"").trim();if(!operationId)throw Object.assign(new Error("Operação ausente."),{statusCode:400});
      await requireMembership(authUser,churchId);
      await serviceRest(`generation_operations?operation_id=eq.${encodeURIComponent(operationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({status:"completed",completed_at:new Date().toISOString(),metadata:b.metadata||{}})});
      const bal=await userRpc(req,"generation_credit_balance",{p_church_id:churchId}).catch(()=>null);
      return res.json({ok:true,balance:typeof bal==="number"?bal:bal?.balance??null});
    }

    if(action==="generation-operation-fail"&&req.method==="POST"){
      const b=req.body||{},operationId=String(b.operationId||"").trim();if(!operationId)throw Object.assign(new Error("Operação ausente."),{statusCode:400});
      await requireMembership(authUser,churchId);
      const op=(await serviceRest(`generation_operations?operation_id=eq.${encodeURIComponent(operationId)}&church_id=eq.${encodeURIComponent(churchId)}&select=*&limit=1`))?.[0];
      let refund={balance:null,refunded:0};
      if(op?.credits_reserved>0)refund=await userRpc(req,"refund_generation_credits",{p_church_id:churchId,p_operation_id:operationId,p_metadata:{failure_class:b.failureClass||"processing",stage:b.stage||"generation"}});
      await serviceRest(`generation_operations?operation_id=eq.${encodeURIComponent(operationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({status:b.failureClass==="cancelled"?"cancelled":"failed",failed_at:new Date().toISOString(),failure_class:String(b.failureClass||"processing"),failure_stage:String(b.stage||"generation"),failure_message:String(b.message||"").slice(0,8000),credits_refunded:Number(refund?.refunded)||0,metadata:b.metadata||{}})});
      await persistAppError({churchId,userId:authUser.id,operationId,category:b.failureClass||"processing",stage:b.stage||"generation",technicalMessage:b.message||"",metadata:b.metadata||{}});
      return res.json({ok:true,creditsRefunded:Number(refund?.refunded)||0,balance:refund?.balance??null});
    }

    if(action==="log-app-error"&&req.method==="POST"){
      const b=req.body||{};await requireMembership(authUser,churchId);
      await persistAppError({churchId,userId:authUser.id,operationId:b.operationId||null,category:b.category||"processing",stage:b.stage||"app",severity:b.severity||"error",userMessage:b.userMessage||"",technicalMessage:b.technicalMessage||"",stack:b.stack||"",metadata:b.metadata||{}});
      return res.json({ok:true});
    }

    if(action==="billing-error-history"){
      await requireAppAdmin(req,authUser);
      const [rows,churches,profiles,users]=await Promise.all([
        serviceRest("app_error_logs?select=*&order=created_at.desc&limit=3000"),
        serviceRest("church_profile?select=id,name,label"),
        serviceRest("user_profiles?select=user_id,name"),
        listAuthUsers()
      ]);
      const cm=new Map((churches||[]).map(x=>[x.id,x.label||x.name||"Igreja"])),pm=new Map((profiles||[]).map(x=>[x.user_id,x.name||""])),um=new Map((users||[]).map(x=>[x.id,x.email||""]));
      const errors=(rows||[]).map(x=>({id:x.id,createdAt:x.created_at,churchId:x.church_id,churchName:cm.get(x.church_id)||"—",userId:x.user_id,userName:pm.get(x.user_id)||"",userEmail:um.get(x.user_id)||"",operationId:x.operation_id||"",category:x.category,stage:x.stage,severity:x.severity,userMessage:x.user_message||"",technicalMessage:x.technical_message||"",stack:x.stack||"",metadata:x.metadata||{}}));
      return res.json({errors});
    }

    if(action==="billing-cost-history"){
      await requireAppAdmin(req,authUser);
      const [usage,churches,profiles,users]=await Promise.all([
        serviceRest("generation_usage?select=id,church_id,user_id,generation_id,operation_type,model,endpoint,input_tokens,output_tokens,image_count,cost_usd,cost_brl,currency_rate,metadata,created_at&order=created_at.asc&limit=5000"),
        serviceRest("church_profile?select=id,name,label"),
        serviceRest("user_profiles?select=user_id,name"),
        listAuthUsers()
      ]);
      const churchById=new Map((churches||[]).map(x=>[x.id,x.label||x.name||"Igreja"]));
      const profileById=new Map((profiles||[]).map(x=>[x.user_id,x.name||""]));
      const emailById=new Map((users||[]).map(x=>[x.id,x.email||""]));
      const sessions=new Map(),legacyState=new Map();

      for(const row of (usage||[])){
        const meta=row.metadata||{},explicit=String(meta.cost_session_id||"").trim();
        let key=explicit?`tracked:${explicit}`:"";
        if(!key){
          const bucket=`${row.church_id}:${row.user_id}`,t=new Date(row.created_at).getTime()||0,prev=legacyState.get(bucket);
          if(!prev||t-prev.last>10*60*1000){legacyState.set(bucket,{n:(prev?.n||0)+1,last:t});}
          else prev.last=t;
          const cur=legacyState.get(bucket);key=`legacy:${bucket}:${cur.n}`;
        }
        if(!sessions.has(key))sessions.set(key,{key,source:explicit?"tracked":"legacy",rows:[],createdAt:row.created_at,churchId:row.church_id,userId:row.user_id});
        sessions.get(key).rows.push({...row,_cost:estimateHistoryCost(row)});
      }

      const arts=[];
      let unassignedUSD=0,totalCalls=0;
      for(const s of sessions.values()){
        totalCalls+=s.rows.length;
        const genRows=s.rows.filter(r=>r.operation_type==="generation"&&Number(r.image_count||0)>0);
        const total=s.rows.reduce((a,r)=>a+r._cost,0),genDirect=genRows.reduce((a,r)=>a+r._cost,0),support=Math.max(0,total-genDirect);
        if(!genRows.length){unassignedUSD+=total;continue}
        const share=support/genRows.length;
        genRows.forEach(r=>{
          const m=r.metadata||{},type=historyArtType(r),format=String(m.format||m.target_label||"").trim()||type;
          arts.push({
            createdAt:r.created_at,
            projectName:legacyProjectName(r),
            type,format,
            churchId:r.church_id,churchName:churchById.get(r.church_id)||"Igreja",
            userId:r.user_id,userName:profileById.get(r.user_id)||"",userEmail:emailById.get(r.user_id)||"",
            source:s.source,
            costUSD:r._cost+share,
            directImageUSD:r._cost,
            allocatedSupportUSD:share,
            sessionId:s.source==="tracked"?String(m.cost_session_id||""):null
          });
        });
      }

      arts.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      const byTypeMap=new Map();
      for(const a of arts){
        const x=byTypeMap.get(a.type)||{type:a.type,count:0,totalUSD:0,minUSD:Infinity,maxUSD:0};
        x.count++;x.totalUSD+=a.costUSD;x.minUSD=Math.min(x.minUSD,a.costUSD);x.maxUSD=Math.max(x.maxUSD,a.costUSD);byTypeMap.set(a.type,x);
      }
      const byType=[...byTypeMap.values()].map(x=>({...x,avgUSD:x.count?x.totalUSD/x.count:0,minUSD:Number.isFinite(x.minUSD)?x.minUSD:0})).sort((a,b)=>b.count-a.count);
      const byUserMap=new Map();
      for(const a of arts){
        const k=a.userId||"unknown",x=byUserMap.get(k)||{userId:a.userId||"",userName:a.userName||"",userEmail:a.userEmail||"",count:0,totalUSD:0};
        x.count++;x.totalUSD+=a.costUSD;byUserMap.set(k,x);
      }
      const byUser=[...byUserMap.values()].map(x=>({...x,avgUSD:x.count?x.totalUSD/x.count:0})).sort((a,b)=>b.totalUSD-a.totalUSD);
      const totalUSD=arts.reduce((a,x)=>a+x.costUSD,0);
      return res.json({
        summary:{artCount:arts.length,totalUSD,avgUSD:arts.length?totalUSD/arts.length:0,legacyArts:arts.filter(x=>x.source==="legacy").length,totalCalls,unassignedUSD},
        byType,byUser,arts:arts.slice(0,1500)
      });
    }

    if(action==="billing-bootstrap"){
      await requireAppAdmin(req,authUser);
      const [churches,members,profiles,plans,subs,coupons,redemptions,usage,users]=await Promise.all([
        serviceRest("church_profile?select=id,name,address,created_at&order=created_at.desc"),
        serviceRest("church_members?status=eq.active&select=church_id,user_id,role,status,created_at"),
        serviceRest("user_profiles?select=user_id,name"),
        serviceRest("plans?select=*&order=sort_order.asc,name.asc"),
        serviceRest("church_subscriptions?select=*&order=created_at.desc"),
        serviceRest("coupons?select=*&order=created_at.desc"),
        serviceRest("coupon_redemptions?select=coupon_id,church_id,status"),
        serviceRest(`generation_usage?created_at=gte.${encodeURIComponent(monthStartISO())}&select=church_id,user_id,operation_type,cost_brl,cost_usd,created_at`),
        listAuthUsers()
      ]);
      const emailById=new Map((users||[]).map(u=>[u.id,u.email||""]));
      const profileById=new Map((profiles||[]).map(p=>[p.user_id,p.name||""]));
      const usageByUser=new Map();
      for(const u of (usage||[])){
        const k=`${u.church_id}:${u.user_id}`;
        const x=usageByUser.get(k)||{arts:0,costBRL:0,costUSD:0};
        if(u.operation_type==="generation")x.arts++;
        x.costBRL+=Number(u.cost_brl)||0;
        x.costUSD+=Number(u.cost_usd)||0;
        usageByUser.set(k,x);
      }
      const memberRows=(members||[]).map(m=>{
        const x=usageByUser.get(`${m.church_id}:${m.user_id}`)||{arts:0,costBRL:0,costUSD:0};
        return {...m,name:profileById.get(m.user_id)||"",email:emailById.get(m.user_id)||"",monthlyArts:x.arts,monthlyCostBRL:x.costBRL,monthlyCostUSD:x.costUSD};
      });
      const redemptionCount={};
      for(const x of (redemptions||[]))if(x.status==="applied")redemptionCount[x.coupon_id]=(redemptionCount[x.coupon_id]||0)+1;
      return res.json({churches:churches||[],members:memberRows,plans:plans||[],subscriptions:subs||[],coupons:(coupons||[]).map(c=>({...c,usedCount:redemptionCount[c.id]||0}))});
    }

    if(action==="billing-save-plan"&&req.method==="POST"){
      await requireAppAdmin(req,authUser);
      const b=req.body||{};
      const code=String(b.code||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-");
      if(!code||!String(b.name||"").trim())throw Object.assign(new Error("Código e nome do plano são obrigatórios."),{statusCode:400});
      const row={
        code,
        name:String(b.name).trim(),
        price_monthly:Number(b.priceMonthly)||0,
        credits_monthly:b.creditsMonthly===''||b.creditsMonthly==null?null:Number(b.creditsMonthly),
        reference_limit:b.referenceLimit===''||b.referenceLimit==null?null:Number(b.referenceLimit),
        user_limit:Math.min(3,Math.max(1,Number(b.userLimit)||3)),
        active:b.active!==false,
        sort_order:Number(b.sortOrder)||0
      };
      const d=await serviceRest("plans?on_conflict=code",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});
      return res.json({ok:true,plan:d?.[0]});
    }

    if(action==="billing-set-subscription"&&req.method==="POST"){
      await requireAppAdmin(req,authUser);
      const b=req.body||{},targetChurchId=String(b.churchId||""),planId=String(b.planId||"");
      if(!targetChurchId||!planId)throw Object.assign(new Error("Igreja e plano são obrigatórios."),{statusCode:400});
      const plan=(await serviceRest(`plans?id=eq.${encodeURIComponent(planId)}&select=*`))?.[0];
      if(!plan)throw Object.assign(new Error("Plano não encontrado."),{statusCode:404});
      const current=(await serviceRest(`church_subscriptions?church_id=eq.${encodeURIComponent(targetChurchId)}&status=in.(trialing,active,past_due,paused)&select=*&order=created_at.desc&limit=1`))?.[0];
      let sub;
      if(current){
        sub=(await serviceRest(`church_subscriptions?id=eq.${encodeURIComponent(current.id)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({plan_id:plan.id,status:"active",price_monthly:plan.price_monthly,updated_at:new Date().toISOString()})}))?.[0];
      }else{
        sub=(await serviceRest("church_subscriptions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{church_id:targetChurchId,plan_id:plan.id,status:"active",price_monthly:plan.price_monthly,current_period_start:new Date().toISOString(),provider:"manual",metadata:{assigned_by:authUser.id}}])}))?.[0];
      }
      await serviceRest("billing_events",{method:"POST",body:JSON.stringify([{church_id:targetChurchId,actor_user_id:authUser.id,event_type:"subscription_plan_set",entity_type:"church_subscription",entity_id:sub?.id||null,amount:plan.price_monthly,currency:"BRL",metadata:{plan_id:plan.id,plan_code:plan.code}}])});
      return res.json({ok:true,subscription:sub});
    }

    if(action==="billing-create-coupon"&&req.method==="POST"){
      await requireAppAdmin(req,authUser);
      const b=req.body||{},code=String(b.code||"").trim().toUpperCase().replace(/\s+/g,"");
      if(!code)throw Object.assign(new Error("Informe o código do cupom."),{statusCode:400});
      const row={
        code,
        kind:b.kind==="collective"?"collective":"individual",
        discount_type:Number(b.percent)>=100?"free_subscription":"percentage",
        discount_value:Math.min(100,Math.max(1,Number(b.percent)||0)),
        plan_id:b.planId||null,
        duration_months:Math.max(1,Number(b.durationMonths)||1),
        valid_until:b.validUntil?`${b.validUntil}T23:59:59Z`:null,
        max_redemptions:b.kind==="individual"?1:(b.unlimited?null:Math.max(1,Number(b.maxAccounts)||1)),
        unlimited:!!b.unlimited,
        active:true,
        created_by:authUser.id,
        metadata:{source:"admin_panel"}
      };
      const d=await serviceRest("coupons",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([row])});
      return res.json({ok:true,coupon:d?.[0]});
    }

    if(action==="billing-disable-coupon"&&req.method==="POST"){
      await requireAppAdmin(req,authUser);
      const id=req.body?.couponId;
      if(!id)throw Object.assign(new Error("Cupom ausente."),{statusCode:400});
      await serviceRest(`coupons?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});
      return res.json({ok:true});
    }

    if(action==="account-context"){
      const [membershipRows,isAdmin,viewerProfiles]=await Promise.all([
        userRpc(req,"get_my_churches",{}),
        userRpc(req,"is_app_admin",{}),
        serviceRest(`user_profiles?user_id=eq.${encodeURIComponent(authUser.id)}&select=user_id,name,tutorial_completed_at`)
      ]);
      const memberships=Array.isArray(membershipRows)?membershipRows:[];
      const ids=memberships.map(x=>x.church_id).filter(Boolean);
      let profiles=[],memberRows=[],userProfiles=[],authUsers=[];
      if(ids.length){
        const idFilter=ids.map(x=>String(x).replace(/[(),]/g,"")).join(",");
        [profiles,memberRows,userProfiles,authUsers]=await Promise.all([
          serviceRest(`church_profile?id=in.(${idFilter})&select=*`),
          serviceRest(`church_members?church_id=in.(${idFilter})&role=eq.owner&status=eq.active&select=church_id,user_id`),
          serviceRest("user_profiles?select=user_id,name"),
          listAuthUsers()
        ]);
      }
      const profileById=new Map((profiles||[]).map(p=>[p.id,p]));
      const ownerIdByChurch=new Map((memberRows||[]).map(m=>[m.church_id,m.user_id]));
      const userProfileById=new Map((userProfiles||[]).map(p=>[p.user_id,p]));
      const authById=new Map((authUsers||[]).map(u=>[u.id,u]));
      const churches=memberships.map(m=>{
        const p=profileById.get(m.church_id)||{};
        const ownerId=ownerIdByChurch.get(m.church_id);
        const ownerProfile=userProfileById.get(ownerId)||{};
        const ownerAuth=authById.get(ownerId)||{};
        return {
          ...m,
          name:p.name||m.name||"",
          label:p.label||p.name||m.name||"",
          address:p.address||m.address||"",
          pastor_name:p.pastor_name||"",
          responsible_whatsapp:p.responsible_whatsapp||"",
          profile_logo_url:p.profile_logo_url||null,
          owner_name:ownerProfile.name||ownerAuth.user_metadata?.name||ownerAuth.user_metadata?.full_name||"",
          owner_email:ownerAuth.email||""
        };
      });
      const viewerProfile=(viewerProfiles||[])[0]||{};
      return res.json({churches,isAdmin:!!isAdmin,firstLogin:!viewerProfile.tutorial_completed_at,tutorialCompletedAt:viewerProfile.tutorial_completed_at||null});
    }

    if(action==="complete-tutorial"&&req.method==="POST"){
      const completedAt=new Date().toISOString();
      const rows=await serviceRest(`user_profiles?user_id=eq.${encodeURIComponent(authUser.id)}`,{
        method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({tutorial_completed_at:completedAt,updated_at:completedAt})
      });
      if(!rows?.length){
        await serviceRest("user_profiles",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{user_id:authUser.id,name:"",tutorial_completed_at:completedAt}])});
      }
      return res.json({ok:true,tutorialCompletedAt:completedAt});
    }
    if(action==="create-church"&&req.method==="POST"){
      const body=req.body||{};
      const cleanName=String(body.name||'').trim();
      const churchId=await userRpc(req,"create_my_church",{church_name:cleanName,church_address:String(body.address||'').trim()});
      if(churchId)await serviceRest(`church_profile?id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({label:cleanName})});
      return res.json({ok:true,churchId});
    }

    if(action==="update-church"&&req.method==="POST"){
      const b=req.body||{},targetChurchId=String(b.churchId||"").trim();
      if(!targetChurchId)throw Object.assign(new Error("Igreja ausente."),{statusCode:400});
      await requireMembership(authUser,targetChurchId,{owner:true});
      const name=String(b.name||"").trim();
      const label=String(b.label||"").trim();
      if(!name)throw Object.assign(new Error("Nome oficial da igreja é obrigatório."),{statusCode:400});
      const row={
        name,
        label:label||name,
        pastor_name:String(b.pastorName||"").trim(),
        responsible_whatsapp:String(b.responsibleWhatsapp||"").trim(),
        address:String(b.address||"").trim(),
        updated_at:new Date().toISOString()
      };
      const d=await serviceRest(`church_profile?id=eq.${encodeURIComponent(targetChurchId)}`,{
        method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(row)
      });
      return res.json({ok:true,church:d?.[0]||{id:targetChurchId,...row}});
    }

    if(action==="upload-church-profile-logo"&&req.method==="POST"){
      const b=req.body||{},targetChurchId=String(b.churchId||"").trim();
      if(!targetChurchId)throw Object.assign(new Error("Igreja ausente."),{statusCode:400});
      await requireMembership(authUser,targetChurchId,{owner:true});
      const mime=String(b.mimeType||"image/png");
      if(!mime.startsWith("image/"))throw Object.assign(new Error("Envie um arquivo de imagem."),{statusCode:400});
      const extension=(mime.split("/")[1]||"png").replace(/[^a-z0-9]/gi,"")||"png";
      const objectPath=[targetChurchId,"profile",`church-profile-${Date.now()}.${extension}`].join("/");
      const url=await uploadDataUrl(b.dataUrl,objectPath,mime);
      const d=await serviceRest(`church_profile?id=eq.${encodeURIComponent(targetChurchId)}`,{
        method:"PATCH",headers:{Prefer:"return=representation"},
        body:JSON.stringify({profile_logo_url:url,updated_at:new Date().toISOString()})
      });
      return res.json({ok:true,url,church:d?.[0]||null});
    }

    if(action==="delete-church"&&req.method==="POST"){
      const targetChurchId=String(req.body?.churchId||"").trim();
      if(!targetChurchId)throw Object.assign(new Error("Igreja ausente."),{statusCode:400});
      await requireMembership(authUser,targetChurchId,{owner:true});
      await serviceRest(`church_profile?id=eq.${encodeURIComponent(targetChurchId)}`,{method:"DELETE"});
      return res.json({ok:true,deletedChurchId:targetChurchId});
    }

    if(action==="accept-invite"&&req.method==="POST"){
      const token=String(req.body?.token||'').trim();
      if(!token)throw Object.assign(new Error("Token de convite ausente."),{statusCode:400});
      const result=await userRpc(req,"accept_church_invite",{invite_token:token});
      return res.json({ok:true,membership:Array.isArray(result)?result[0]:result});
    }

    const churchId=requestedChurchId(req);
    const membership=await requireMembership(authUser,churchId);


    if(action==="feed-list"){
      const posts=await serviceRest("feed_posts?active=eq.true&select=*&order=published_at.desc&limit=80");
      return res.json({posts:await enrichFeedPosts(posts||[],authUser.id)});
    }

    if(action==="feed-detail"){
      const postId=String(req.query.postId||req.body?.postId||"").trim();
      if(!postId)throw Object.assign(new Error("Post ausente."),{statusCode:400});
      const post=(await serviceRest(`feed_posts?id=eq.${encodeURIComponent(postId)}&active=eq.true&select=*&limit=1`))?.[0];
      if(!post)throw Object.assign(new Error("Publicação não encontrada."),{statusCode:404});
      const enriched=(await enrichFeedPosts([post],authUser.id))?.[0];
      const gm=await latestGalleryMap(post.church_id);
      const derivatives=[...gm.values()].filter(im=>isFinalDerivative(im,post.gallery_id)).map(im=>({
        gallery_id:im.galleryId,label:im.label||"Arte derivada",image_url:im.url||null,format:im.format||im.recipe?.format||"",target:im.target||im.recipe?.target||{}
      }));
      return res.json({post:enriched,derivatives});
    }

    if(action==="feed-toggle-like"&&req.method==="POST"){
      const postId=String(req.body?.postId||"").trim();
      if(!postId)throw Object.assign(new Error("Post ausente."),{statusCode:400});
      const post=(await serviceRest(`feed_posts?id=eq.${encodeURIComponent(postId)}&active=eq.true&select=*&limit=1`))?.[0];
      if(!post)throw Object.assign(new Error("Publicação não encontrada."),{statusCode:404});
      const existing=(await serviceRest(`feed_likes?post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(authUser.id)}&select=id&limit=1`))?.[0];
      if(existing){
        await serviceRest(`feed_likes?id=eq.${encodeURIComponent(existing.id)}`,{method:"DELETE"});
        await serviceRest(`notifications?recipient_user_id=eq.${encodeURIComponent(post.author_user_id)}&actor_user_id=eq.${encodeURIComponent(authUser.id)}&feed_post_id=eq.${encodeURIComponent(postId)}&type=eq.feed_like&read_at=is.null`,{method:"DELETE"});
      }else{
        await serviceRest("feed_likes",{method:"POST",body:JSON.stringify([{post_id:postId,user_id:authUser.id}])});
        if(String(post.author_user_id)!==String(authUser.id))await serviceRest("notifications",{method:"POST",body:JSON.stringify([{
          recipient_user_id:post.author_user_id,actor_user_id:authUser.id,actor_church_id:churchId,feed_post_id:postId,type:"feed_like"
        }])});
      }
      const rows=await serviceRest(`feed_likes?post_id=eq.${encodeURIComponent(postId)}&select=user_id`);
      return res.json({ok:true,liked:!existing,likeCount:(rows||[]).length});
    }

    if(action==="notifications-list"){
      const rows=await serviceRest(`notifications?recipient_user_id=eq.${encodeURIComponent(authUser.id)}&select=*&order=created_at.desc&limit=80`);
      const actorIds=[...new Set((rows||[]).map(n=>n.actor_user_id).filter(Boolean))],churchIds=[...new Set((rows||[]).map(n=>n.actor_church_id).filter(Boolean))],postIds=[...new Set((rows||[]).map(n=>n.feed_post_id).filter(Boolean))];
      const [profiles,users,churches,posts]=await Promise.all([
        actorIds.length?serviceRest(`user_profiles?user_id=in.(${inList(actorIds)})&select=user_id,name`):[],listAuthUsers(),
        churchIds.length?serviceRest(`church_profile?id=in.(${inList(churchIds)})&select=id,name,label,profile_logo_url`):[],
        postIds.length?serviceRest(`feed_posts?id=in.(${inList(postIds)})&select=id,label,image_url`):[]
      ]);
      const pm=new Map((profiles||[]).map(x=>[x.user_id,x])),um=new Map((users||[]).map(x=>[x.id,x])),cm=new Map((churches||[]).map(x=>[x.id,x])),fm=new Map((posts||[]).map(x=>[x.id,x]));
      const notifications=(rows||[]).map(n=>{const up=pm.get(n.actor_user_id)||{},au=um.get(n.actor_user_id)||{},ch=cm.get(n.actor_church_id)||{},fp=fm.get(n.feed_post_id)||{};return {...n,
        actor_name:up.name||au.user_metadata?.name||au.user_metadata?.full_name||au.email||"Alguém",actor_email:au.email||"",
        actor_church_label:ch.label||ch.name||"uma igreja",actor_church_logo:ch.profile_logo_url||null,post_label:fp.label||"sua arte",post_image_url:fp.image_url||null};});
      return res.json({notifications,unreadCount:notifications.filter(n=>!n.read_at).length});
    }

    if(action==="notifications-read"&&req.method==="POST"){
      const id=String(req.body?.id||"").trim(),now=new Date().toISOString();
      if(id)await serviceRest(`notifications?id=eq.${encodeURIComponent(id)}&recipient_user_id=eq.${encodeURIComponent(authUser.id)}`,{method:"PATCH",body:JSON.stringify({read_at:now})});
      else await serviceRest(`notifications?recipient_user_id=eq.${encodeURIComponent(authUser.id)}&read_at=is.null`,{method:"PATCH",body:JSON.stringify({read_at:now})});
      return res.json({ok:true});
    }

    if(action==="notifications-count"){
      const rows=await serviceRest(`notifications?recipient_user_id=eq.${encodeURIComponent(authUser.id)}&read_at=is.null&select=id`);
      return res.json({unreadCount:(rows||[]).length});
    }

    if(action==="feed-settings"){
      if(membership.role!=="owner")throw Object.assign(new Error("Somente o responsável pode alterar a publicação no Feed."),{statusCode:403});
      const profile=(await serviceRest(`church_profile?id=eq.${encodeURIComponent(churchId)}&select=feed_publish_all`))?.[0];
      return res.json({publishAll:!!profile?.feed_publish_all});
    }

    if(action==="set-feed-settings"&&req.method==="POST"){
      if(membership.role!=="owner")throw Object.assign(new Error("Somente o responsável pode alterar a publicação no Feed."),{statusCode:403});
      const enabled=!!req.body?.publishAll;
      await serviceRest(`church_profile?id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({feed_publish_all:enabled,updated_at:new Date().toISOString()})});
      let published=0;
      if(enabled){
        const gm=await latestGalleryMap(churchId),legacyIds=new Set((req.body?.downloadedGalleryIds||[]).map(String));
        for(const im of gm.values()){
          const downloaded=!!im?.recipe?.downloadedAt||legacyIds.has(String(im.galleryId||""));
          if(!downloaded||!isFinalMother(im))continue;
          im.recipe={...(im.recipe||{}),downloadedAt:im.recipe?.downloadedAt||new Date().toISOString()};
          if(await publishFeedPostForItem(churchId,im,authUser.id))published++;
        }
      }
      return res.json({ok:true,publishAll:enabled,published});
    }


    if(action==="publish-gallery-item"&&req.method==="POST"){
      const galleryId=String(req.body?.galleryId||"").trim();
      if(!galleryId)throw Object.assign(new Error("galleryId obrigatório."),{statusCode:400});
      const rows=await serviceRest(`church_generations?church_id=eq.${encodeURIComponent(churchId)}&select=id,images,created_at&order=created_at.desc&limit=300`);
      let found=null,foundGeneration=null,foundImages=null,foundPos=-1;
      for(const g of (rows||[])){
        const images=Array.isArray(g.images)?g.images:[];
        const pos=images.findIndex(im=>String(im?.galleryId||"")===galleryId);
        if(pos<0)continue;
        found={...images[pos],generationId:g.id};foundGeneration=g.id;foundImages=images;foundPos=pos;break;
      }
      if(!found)throw Object.assign(new Error("Arte não encontrada na galeria desta igreja."),{statusCode:404});
      if(!isFinalMother(found))throw Object.assign(new Error("Somente a arte principal finalizada pode ser publicada no Feed."),{statusCode:409});
      const now=new Date().toISOString();
      found.recipe={...(found.recipe||{}),downloadedAt:found.recipe?.downloadedAt||now,createdByUserId:found.recipe?.createdByUserId||authUser.id,createdByEmail:found.recipe?.createdByEmail||authUser.email||""};
      found.downloadedAt=found.recipe.downloadedAt;
      let post=await publishFeedPostForItem(churchId,found,authUser.id,{force:true});
      if(!post)throw Object.assign(new Error("Não foi possível publicar esta arte."),{statusCode:500});

      // Publicação manual significa "postar agora": sobe para o topo do Feed.
      const fresh=(await serviceRest(`feed_posts?id=eq.${encodeURIComponent(post.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({published_at:now,updated_at:now,active:true})
      }))?.[0];
      post=fresh||post;

      found.recipe.feedPublishedAt=now;
      found.feedPublishedAt=now;
      foundImages[foundPos]={...foundImages[foundPos],...found};
      await serviceRest(`church_generations?id=eq.${encodeURIComponent(foundGeneration)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({images:foundImages})});
      return res.json({ok:true,published:true,postId:post.id,publishedAt:now});
    }

    if(action==="mark-gallery-downloaded"&&req.method==="POST"){
      const galleryId=String(req.body?.galleryId||"").trim();
      if(!galleryId)throw Object.assign(new Error("galleryId obrigatório."),{statusCode:400});
      const rows=await serviceRest(`church_generations?church_id=eq.${encodeURIComponent(churchId)}&select=id,images,created_at&order=created_at.desc&limit=300`);
      let found=null,foundGeneration=null;
      for(const g of (rows||[])){
        const images=Array.isArray(g.images)?g.images:[];
        const pos=images.findIndex(im=>String(im?.galleryId||"")===galleryId);
        if(pos<0)continue;
        const current=images[pos],recipe={...(current.recipe||{}),downloadedAt:current.recipe?.downloadedAt||new Date().toISOString(),createdByUserId:current.recipe?.createdByUserId||authUser.id,createdByEmail:current.recipe?.createdByEmail||authUser.email||""};
        images[pos]={...current,downloadedAt:recipe.downloadedAt,recipe};
        await serviceRest(`church_generations?id=eq.${encodeURIComponent(g.id)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({images})});
        found={...images[pos],generationId:g.id};foundGeneration=g.id;break;
      }
      if(!found)throw Object.assign(new Error("Arte não encontrada na galeria desta igreja."),{statusCode:404});
      if(found.recipe?.finalized===false)throw Object.assign(new Error("A arte ainda é um rascunho e não pode ser publicada."),{statusCode:409});
      const post=await publishFeedPostForItem(churchId,found,authUser.id);
      if(post){
        const rows2=await serviceRest(`church_generations?id=eq.${encodeURIComponent(foundGeneration)}&church_id=eq.${encodeURIComponent(churchId)}&select=images&limit=1`);
        const images2=Array.isArray(rows2?.[0]?.images)?rows2[0].images:[];
        const pos2=images2.findIndex(im=>String(im?.galleryId||"")===galleryId);
        if(pos2>=0){
          images2[pos2]={...images2[pos2],feedPublishedAt:post.published_at||new Date().toISOString(),recipe:{...(images2[pos2].recipe||{}),feedPublishedAt:post.published_at||new Date().toISOString()}};
          await serviceRest(`church_generations?id=eq.${encodeURIComponent(foundGeneration)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({images:images2})});
        }
      }
      return res.json({ok:true,downloadedAt:found.recipe.downloadedAt,published:!!post,postId:post?.id||null,publishedAt:post?.published_at||null,generationId:foundGeneration});
    }



    if(action==="merge-gallery-projects"&&req.method==="POST"){
      const requested=[...new Set((Array.isArray(req.body?.projectIds)?req.body.projectIds:[]).map(String).filter(Boolean))];
      if(requested.length<2)throw Object.assign(new Error("Selecione pelo menos dois projetos para mesclar."),{statusCode:400});

      const gm=await latestGalleryMap(churchId);
      const byId=new Map([...gm.entries()].map(([id,x])=>[String(id),x]));
      const requestedGroups=new Set();
      for(const id of requested){
        const item=byId.get(String(id));
        if(!item)throw Object.assign(new Error("Um dos projetos selecionados não foi encontrado."),{statusCode:404});
        requestedGroups.add(galleryItemMergeGroup(item,byId));
      }
      if(requestedGroups.size<2)throw Object.assign(new Error("Esses projetos já pertencem ao mesmo grupo."),{statusCode:409});

      const members=[...gm.values()].filter(x=>requestedGroups.has(galleryItemMergeGroup(x,byId)));
      if(!members.length)throw Object.assign(new Error("Nenhuma arte encontrada para os projetos selecionados."),{statusCode:404});

      // Capa sempre = arte original do projeto mais antigo.
      const roots=members.filter(x=>galleryItemNaturalRoot(x,byId)===String(x.galleryId||""));
      roots.sort((a,b)=>galleryItemTime(a)-galleryItemTime(b));
      const oldestRoot=roots[0]||members.slice().sort((a,b)=>galleryItemTime(a)-galleryItemTime(b))[0];
      const mergeGroupId=String(oldestRoot.galleryId);
      const mergedAt=new Date().toISOString();

      // Atualiza somente a ocorrência persistida mais recente de cada galleryId.
      const rows=await serviceRest(`church_generations?church_id=eq.${encodeURIComponent(churchId)}&select=id,images,created_at&order=created_at.desc&limit=300`);
      const targetIds=new Set(members.map(x=>String(x.galleryId)));
      const updatedIds=new Set();
      const patches=[];
      for(const g of (rows||[])){
        const images=Array.isArray(g.images)?g.images:[];
        let changed=false;
        const next=images.map(im=>{
          const gid=String(im?.galleryId||"");
          if(!gid||!targetIds.has(gid)||updatedIds.has(gid))return im;
          updatedIds.add(gid);changed=true;
          return {
            ...im,
            mergeGroupId,
            recipe:{...(im.recipe||{}),mergeGroupId,mergedAt,mergeCoverGalleryId:mergeGroupId}
          };
        });
        if(changed)patches.push({id:g.id,images:next});
        if(updatedIds.size>=targetIds.size)break;
      }
      for(const p of patches){
        await serviceRest(`church_generations?id=eq.${encodeURIComponent(p.id)}&church_id=eq.${encodeURIComponent(churchId)}`,{
          method:"PATCH",body:JSON.stringify({images:p.images})
        });
      }
      return res.json({ok:true,mergeGroupId,coverGalleryId:mergeGroupId,mergedProjects:requestedGroups.size,mergedArtworks:members.length});
    }

    if(action==="create-art-share"&&req.method==="POST"){
      const galleryId=String(req.body?.galleryId||"").trim();
      const expiresHours=Number(req.body?.expiresHours)||168;
      if(!galleryId)throw Object.assign(new Error("Arte não informada."),{statusCode:400});

      const gm=await latestGalleryMap(churchId);
      const source=gm.get(galleryId);
      if(!source)throw Object.assign(new Error("Arte não encontrada na Galeria desta igreja."),{statusCode:404});
      if(source?.recipe?.finalized===false)throw Object.assign(new Error("A arte ainda é um rascunho."),{statusCode:409});

      const byId=new Map([...gm.entries()].map(([id,x])=>[String(id),x]));
      const root=galleryItemMergeGroup(source,byId);
      const packageItems=[...gm.values()]
        .filter(x=>galleryItemMergeGroup(x,byId)===root && x?.recipe?.finalized!==false)
        .sort((a,b)=>{
          if(String(a.galleryId)===root)return -1;
          if(String(b.galleryId)===root)return 1;
          return new Date(a.generationCreatedAt||0)-new Date(b.generationCreatedAt||0);
        });

      const galleryIds=packageItems.map(x=>String(x.galleryId)).filter(Boolean);
      if(!galleryIds.length)throw Object.assign(new Error("Nenhuma arte finalizada disponível para compartilhar."),{statusCode:409});

      const main=byId.get(root)||packageItems.slice().sort((a,b)=>galleryItemTime(a)-galleryItemTime(b))[0]||source;
      const title=String(main?.recipe?.projectName||main?.projectName||main?.recipe?.quick?.title||main?.label||"Pacote de artes").trim().slice(0,160);
      const token=shareToken(),expiresAt=shareExpiryISO(expiresHours);

      const saved=await serviceRest("art_share_links",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify([{
          token,
          church_id:churchId,
          created_by:authUser.id,
          root_gallery_id:root,
          gallery_ids:galleryIds,
          title,
          expires_at:expiresAt
        }])
      });

      return res.json({
        ok:true,
        token,
        expiresAt,
        title,
        artCount:galleryIds.length,
        sharePath:`/share.html?token=${encodeURIComponent(token)}`,
        share:saved?.[0]||null
      });
    }

    if(action==="access-context"){
      const context=await userRpc(req,"get_church_access_context",{target_church_id:churchId});
      return res.json({context,membership});
    }
    if(action==="team"){
      if(membership.role!=="owner")throw Object.assign(new Error("Somente o responsável pode gerenciar a equipe."),{statusCode:403});
      const [team,inviteRows]=await Promise.all([
        userRpc(req,"get_church_team",{target_church_id:churchId}),
        serviceRest(`church_invites?church_id=eq.${encodeURIComponent(churchId)}&status=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,email,status,token,expires_at,created_at&order=created_at.desc`)
      ]);
      const invites=(inviteRows||[]).map(i=>({invite_id:i.id,email:i.email,status:i.status,token:i.token,expires_at:i.expires_at,created_at:i.created_at}));
      return res.json({team:team||[],invites});
    }
    if(action==="create-invite"&&req.method==="POST"){
      if(membership.role!=="owner")throw Object.assign(new Error("Somente o responsável pode convidar colaboradores."),{statusCode:403});
      const email=String(req.body?.email||'').trim();
      const result=await userRpc(req,"create_church_invite",{target_church_id:churchId,target_email:email});
      let invite=Array.isArray(result)?result[0]:result;
      if(!invite?.token&&!invite?.invite_token){
        const rows=await serviceRest(`church_invites?church_id=eq.${encodeURIComponent(churchId)}&email=eq.${encodeURIComponent(email)}&status=eq.pending&select=id,email,token,expires_at,created_at&order=created_at.desc&limit=1`);invite=rows?.[0]||invite;
      }
      return res.json({ok:true,invite:{invite_id:invite?.invite_id||invite?.id||null,token:invite?.token||invite?.invite_token||null,email:invite?.email||email,expires_at:invite?.expires_at||invite?.expires||null}});
    }
    if(action==="cancel-invite"&&req.method==="POST"){
      await userRpc(req,"cancel_church_invite",{target_invite_id:req.body?.inviteId});return res.json({ok:true});
    }
    if(action==="remove-collaborator"&&req.method==="POST"){
      await userRpc(req,"remove_church_collaborator",{target_church_id:churchId,target_user_id:req.body?.userId});return res.json({ok:true});
    }

    if(action==="bootstrap"){
      const warnings=[];const safe=async(path,label,fallback=[])=>{try{return await serviceRest(path)}catch(e){warnings.push(`${label}: ${e.message}`);return fallback}};
      const [assets,profile,generations,drafts]=await Promise.all([
        safe(`church_assets?church_id=eq.${encodeURIComponent(churchId)}&select=*&order=created_at.desc`,"assets"),
        safe(`church_profile?id=eq.${encodeURIComponent(churchId)}&select=*`,"profile"),
        safe(`church_generations?church_id=eq.${encodeURIComponent(churchId)}&select=*&order=created_at.desc&limit=100`,"gallery"),
        safe(`church_drafts?church_id=eq.${encodeURIComponent(churchId)}&select=*&order=updated_at.desc&limit=60`,"drafts")
      ]);
      return res.json({profile:profile?.[0]||null,assets:assets||[],generations:generations||[],drafts:drafts||[],bootstrapWarnings:warnings,legacyAssetsRecovered:false,membership});
    }

    if(action==="save-profile"&&req.method==="POST"){
      const body=req.body||{};
      const data=await serviceRest(`church_profile?id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({name:body.name||"",address:body.address||"",screen_config:body.screenConfig||{preset:"16:9",width:1920,height:1080},updated_at:new Date().toISOString()})});
      return res.json({profile:data?.[0]||null});
    }

    if(action==="upload-asset"&&req.method==="POST"){
      const body=req.body||{},id=crypto.randomUUID(),originalName=safeName(body.name||"file.bin"),type=safeName(body.type||"asset");
      const objectPath=[churchId,type,`${id}-${originalName}`].join("/");
      const publicUrl=await uploadDataUrl(body.dataUrl,objectPath,body.mimeType);
      const data=await serviceRest("church_assets",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{id,church_id:churchId,type:body.type||"graphic",name:body.name||"Asset",url:publicUrl,mime_type:body.mimeType||"",meta:body.meta||{},is_primary:false}])});
      return res.json({asset:data?.[0]});
    }

    if(action==="update-asset-meta"&&req.method==="POST"){
      const body=req.body||{},id=body.id;if(!id)throw Object.assign(new Error("ID do asset ausente."),{statusCode:400});
      const rows=await serviceRest(`church_assets?id=eq.${encodeURIComponent(id)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`),current=rows?.[0];if(!current)throw Object.assign(new Error("Asset não encontrado."),{statusCode:404});
      const updated=await serviceRest(`church_assets?id=eq.${encodeURIComponent(id)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({meta:{...(current.meta||{}),...(body.meta||{})}})});
      return res.json({asset:updated?.[0]||current,metadataPersisted:true});
    }

    if(action==="delete-asset"&&req.method==="DELETE"){
      const id=req.body?.id;if(!id)throw Object.assign(new Error("ID ausente."),{statusCode:400});
      await serviceRest(`church_assets?id=eq.${encodeURIComponent(id)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"DELETE"});return res.json({ok:true});
    }

    if(action==="upload-generation"&&req.method==="POST"){
      const id=crypto.randomUUID(),objectPath=[churchId,"generations",`${Date.now()}-${id}.png`].join("/");
      const url=await uploadDataUrl(req.body?.dataUrl,objectPath,"image/png");return res.json({url});
    }

    if(action==="save-generation"&&req.method==="POST"){
      const body=req.body||{};
      const data=await serviceRest("church_generations",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{church_id:churchId,format:body.format||"feed",images:body.images||[]}])});
      return res.json({generation:data?.[0]});
    }

    if(action==="rename-gallery-project"&&req.method==="POST"){
      const body=req.body||{},generationId=body.generationId,galleryId=body.galleryId,projectName=String(body.projectName||"").trim();
      if(!generationId||!galleryId||!projectName)throw Object.assign(new Error("generationId, galleryId e projectName são obrigatórios."),{statusCode:400});
      const rows=await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`),generation=rows?.[0];if(!generation)throw Object.assign(new Error("Projeto não encontrado."),{statusCode:404});
      let found=false;const images=(Array.isArray(generation.images)?generation.images:[]).map(im=>{if(String(im?.galleryId||"")!==String(galleryId))return im;found=true;return{...im,projectName,recipe:{...(im.recipe||{}),projectName}}});
      if(!found)throw Object.assign(new Error("Arte principal do projeto não encontrada."),{statusCode:404});
      const updated=await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({images})});
      return res.json({ok:true,projectName,generation:updated?.[0]||null});
    }

    if(action==="delete-gallery-item"&&req.method==="DELETE"){
      const body=req.body||{},generationId=String(body.generationId||""),galleryId=String(body.galleryId||""),imageUrl=String(body.imageUrl||""),label=String(body.label||""),imageIndex=Number.isInteger(Number(body.imageIndex))?Number(body.imageIndex):-1;
      if(!generationId)throw Object.assign(new Error("generationId é obrigatório."),{statusCode:400});
      const rows=await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`),generation=rows?.[0];
      if(!generation)return res.json({ok:true,alreadyMissing:true});
      const images=Array.isArray(generation.images)?generation.images:[];
      let deleteIndex=-1;
      if(galleryId)deleteIndex=images.findIndex(im=>String(im?.galleryId||"")===galleryId);
      if(deleteIndex<0&&imageUrl)deleteIndex=images.findIndex(im=>String(im?.url||im?.dataUrl||"")===imageUrl);
      if(deleteIndex<0&&imageIndex>=0&&imageIndex<images.length){
        const candidate=images[imageIndex],candidateUrl=String(candidate?.url||candidate?.dataUrl||""),candidateLabel=String(candidate?.label||"");
        if((!imageUrl||candidateUrl===imageUrl)&&(!label||candidateLabel===label))deleteIndex=imageIndex;
      }
      if(deleteIndex<0)return res.json({ok:true,alreadyMissing:true,reason:"image_not_found"});
      const deleted=images[deleteIndex],remaining=images.filter((_,idx)=>idx!==deleteIndex);
      if(remaining.length)await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({images:remaining})});
      else await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"DELETE"});
      const deletedGalleryId=String(deleted?.galleryId||galleryId||"");
      if(deletedGalleryId){try{await serviceRest(`feed_posts?church_id=eq.${encodeURIComponent(churchId)}&gallery_id=eq.${encodeURIComponent(deletedGalleryId)}`,{method:"PATCH",body:JSON.stringify({active:false,updated_at:new Date().toISOString()})})}catch(feedErr){console.warn("delete-gallery-item: feed cleanup skipped",feedErr?.message||feedErr)}}
      return res.json({ok:true,deletedGalleryId:deletedGalleryId||null,legacy:!deleted?.galleryId});
    }

    if(action==="save-draft"&&req.method==="POST"){
      const body=req.body||{},id=body.id||crypto.randomUUID();
      const data=await serviceRest("church_drafts?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([{id,church_id:churchId,title:body.title||"Esboço",data:body.data||{},updated_at:new Date().toISOString()}])});
      return res.json({draft:data?.[0]});
    }
    if(action==="delete-draft"&&req.method==="DELETE"){
      const id=req.body?.id;if(!id)throw Object.assign(new Error("ID do esboço ausente."),{statusCode:400});
      await serviceRest(`church_drafts?id=eq.${encodeURIComponent(id)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"DELETE"});return res.json({ok:true});
    }

    return res.status(400).json({error:"Ação inválida."});
  }catch(error){
    console.error("church-data",error);
    return res.status(error?.statusCode||500).json({error:error?.message||"Erro no banco."});
  }
};
