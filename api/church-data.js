// CHURCHDESIGN — church-data v0.40.0
// ChurchDesign V0.40.0 — multi-church, membership validated, web/mobile-ready
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


function cleanInValue(v){return String(v||"").replace(/[(),\s]/g,"")}
function inList(values=[]){return values.map(cleanInValue).filter(Boolean).join(",")}
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
      const [membershipRows,isAdmin]=await Promise.all([userRpc(req,"get_my_churches",{}),userRpc(req,"is_app_admin",{})]);
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
      return res.json({churches,isAdmin:!!isAdmin});
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
