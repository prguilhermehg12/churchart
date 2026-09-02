// ChurchDesign V0.32.0 — multi-church, membership validated, web/mobile-ready
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
    if(action==="account-context"){
      const [churches,isAdmin]=await Promise.all([userRpc(req,"get_my_churches",{}),userRpc(req,"is_app_admin",{})]);
      return res.json({churches:Array.isArray(churches)?churches:[],isAdmin:!!isAdmin});
    }
    if(action==="create-church"&&req.method==="POST"){
      const body=req.body||{};
      const churchId=await userRpc(req,"create_my_church",{church_name:String(body.name||'').trim(),church_address:String(body.address||'').trim()});
      return res.json({ok:true,churchId});
    }
    if(action==="accept-invite"&&req.method==="POST"){
      const token=String(req.body?.token||'').trim();
      if(!token)throw Object.assign(new Error("Token de convite ausente."),{statusCode:400});
      const result=await userRpc(req,"accept_church_invite",{invite_token:token});
      return res.json({ok:true,membership:Array.isArray(result)?result[0]:result});
    }

    const churchId=requestedChurchId(req);
    const membership=await requireMembership(authUser,churchId);

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
      const body=req.body||{},generationId=body.generationId,galleryId=body.galleryId;if(!generationId||!galleryId)throw Object.assign(new Error("generationId e galleryId são obrigatórios."),{statusCode:400});
      const rows=await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`),generation=rows?.[0];if(!generation)return res.json({ok:true,alreadyMissing:true});
      const images=Array.isArray(generation.images)?generation.images:[],remaining=images.filter(im=>String(im?.galleryId||"")!==String(galleryId));if(remaining.length===images.length)return res.json({ok:true,alreadyMissing:true});
      if(remaining.length)await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",body:JSON.stringify({images:remaining})});
      else await serviceRest(`church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"DELETE"});
      return res.json({ok:true,deletedGalleryId:galleryId});
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
