// CHURCHDESIGN — share-api v0.1.0
const BUCKET="churchart-assets";

function envCfg(){
  const raw=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const secret=process.env.SUPABASE_SECRET_KEY;
  if(!raw||!secret)throw Object.assign(new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configuradas."),{statusCode:500});
  return {url:raw,secret};
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
function cleanToken(v){return String(v||"").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,160)}
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
function publicItem(x={}){
  const r=x.recipe||{};
  return {
    galleryId:String(x.galleryId||""),
    label:String(x.label||r.projectName||"Arte"),
    projectName:String(r.projectName||x.projectName||""),
    url:String(x.url||x.dataUrl||""),
    format:String(x.format||r.format||x.target?.id||""),
    formatLabel:String(x.target?.label||r.target?.label||x.format||""),
    createdAt:x.generationCreatedAt||x.createdAt||null
  };
}

module.exports=async function handler(req,res){
  try{
    if(req.method!=="GET")return res.status(405).json({error:"Método não permitido."});
    const token=cleanToken(req.query?.token);
    if(!token)return res.status(400).json({error:"Link inválido."});

    const share=(await serviceRest(`art_share_links?token=eq.${encodeURIComponent(token)}&revoked_at=is.null&select=id,church_id,title,gallery_ids,expires_at,created_at&limit=1`))?.[0];
    if(!share)return res.status(404).json({error:"Este link não existe ou foi desativado."});
    if(new Date(share.expires_at).getTime()<=Date.now())return res.status(410).json({error:"Este link de download expirou."});

    const [profile,gm]=await Promise.all([
      serviceRest(`church_profile?id=eq.${encodeURIComponent(share.church_id)}&select=id,name,label,profile_logo_url&limit=1`),
      latestGalleryMap(share.church_id)
    ]);
    const ids=Array.isArray(share.gallery_ids)?share.gallery_ids.map(String):[];
    const items=ids.map(id=>gm.get(id)).filter(Boolean).map(publicItem).filter(x=>/^https?:\/\//i.test(x.url));
    if(!items.length)return res.status(404).json({error:"As artes deste pacote não estão mais disponíveis."});

    const ch=profile?.[0]||{};
    res.setHeader("Cache-Control","no-store, max-age=0");
    return res.json({
      ok:true,
      title:share.title||"Pacote de artes",
      expiresAt:share.expires_at,
      createdAt:share.created_at,
      church:{name:ch.label||ch.name||"Igreja",profileLogoUrl:ch.profile_logo_url||null},
      items
    });
  }catch(e){
    console.error("[ChurchDesign share]",e);
    return res.status(e.statusCode||500).json({error:e.message||"Falha ao abrir o compartilhamento."});
  }
};
