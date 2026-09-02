// ChurchDesign billing-admin V0.1 — real Supabase admin data; payment provider still disconnected
function cfg(){const url=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");const anon=process.env.SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SECRET_KEY;if(!url||!anon||!secret)throw Object.assign(new Error("Supabase não configurado."),{statusCode:500});return{url,anon,secret}}
async function authUser(req){const c=cfg(),authorization=String(req.headers.authorization||"");if(!/^Bearer\s+\S+/i.test(authorization))throw Object.assign(new Error("Autenticação obrigatória."),{statusCode:401});const r=await fetch(`${c.url}/auth/v1/user`,{headers:{apikey:c.anon,Authorization:authorization}}),d=await r.json().catch(()=>null);if(!r.ok||!d?.id)throw Object.assign(new Error("Sessão inválida."),{statusCode:401});return d}
async function rpc(req,name,body={}){const c=cfg(),r=await fetch(`${c.url}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:c.anon,Authorization:String(req.headers.authorization||""),"Content-Type":"application/json"},body:JSON.stringify(body)}),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Object.assign(new Error(d?.message||`RPC ${r.status}`),{statusCode:r.status});return d}
async function rest(path,opt={}){const c=cfg(),r=await fetch(`${c.url}/rest/v1/${path}`,{...opt,headers:{apikey:c.secret,Authorization:`Bearer ${c.secret}`,"Content-Type":"application/json",...(opt.headers||{})}}),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Object.assign(new Error(d?.message||d?.error||`REST ${r.status}`),{statusCode:r.status});return d}
async function requireAdmin(req){const user=await authUser(req),ok=await rpc(req,"is_app_admin",{});if(!ok)throw Object.assign(new Error("Acesso administrativo negado."),{statusCode:403});return user}
async function authUsers(){const c=cfg(),r=await fetch(`${c.url}/auth/v1/admin/users?page=1&per_page=1000`,{headers:{apikey:c.secret,Authorization:`Bearer ${c.secret}`}}),d=await r.json().catch(()=>({}));if(!r.ok)return[];return Array.isArray(d?.users)?d.users:Array.isArray(d)?d:[]}
function monthStart(){const d=new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)).toISOString()}

module.exports=async function handler(req,res){try{const actor=await requireAdmin(req),action=String(req.query.action||"bootstrap");
  if(action==="bootstrap"){
    const [churches,members,profiles,plans,subs,coupons,redemptions,usage,users]=await Promise.all([
      rest("church_profile?select=id,name,address,created_at&order=created_at.desc"),rest("church_members?status=eq.active&select=church_id,user_id,role,status,created_at"),rest("user_profiles?select=user_id,name"),rest("plans?select=*&order=sort_order.asc,name.asc"),rest("church_subscriptions?select=*&order=created_at.desc"),rest("coupons?select=*&order=created_at.desc"),rest("coupon_redemptions?select=coupon_id,church_id,status"),rest(`generation_usage?created_at=gte.${encodeURIComponent(monthStart())}&select=church_id,user_id,operation_type,cost_brl,cost_usd,created_at`),authUsers()
    ]);
    const emailById=new Map(users.map(u=>[u.id,u.email||""])),profileById=new Map(profiles.map(p=>[p.user_id,p.name||""]));
    const usageByUser=new Map();for(const u of usage){const k=`${u.church_id}:${u.user_id}`;const x=usageByUser.get(k)||{arts:0,costBRL:0,costUSD:0};if(u.operation_type==="generation")x.arts++;x.costBRL+=Number(u.cost_brl)||0;x.costUSD+=Number(u.cost_usd)||0;usageByUser.set(k,x)}
    const memberRows=members.map(m=>{const x=usageByUser.get(`${m.church_id}:${m.user_id}`)||{arts:0,costBRL:0,costUSD:0};return{...m,name:profileById.get(m.user_id)||"",email:emailById.get(m.user_id)||"",monthlyArts:x.arts,monthlyCostBRL:x.costBRL,monthlyCostUSD:x.costUSD}});
    const redemptionCount={};for(const x of redemptions)if(x.status==="applied")redemptionCount[x.coupon_id]=(redemptionCount[x.coupon_id]||0)+1;
    return res.json({churches,members:memberRows,plans,subscriptions:subs,coupons:coupons.map(c=>({...c,usedCount:redemptionCount[c.id]||0}))});
  }
  if(action==="save-plan"&&req.method==="POST"){
    const b=req.body||{},code=String(b.code||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-");if(!code||!String(b.name||"").trim())throw Object.assign(new Error("Código e nome do plano são obrigatórios."),{statusCode:400});
    const row={code,name:String(b.name).trim(),price_monthly:Number(b.priceMonthly)||0,credits_monthly:b.creditsMonthly===''||b.creditsMonthly==null?null:Number(b.creditsMonthly),reference_limit:b.referenceLimit===''||b.referenceLimit==null?null:Number(b.referenceLimit),user_limit:Math.min(3,Math.max(1,Number(b.userLimit)||3)),active:b.active!==false,sort_order:Number(b.sortOrder)||0};
    const d=await rest("plans?on_conflict=code",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});return res.json({ok:true,plan:d?.[0]});
  }
  if(action==="set-subscription"&&req.method==="POST"){
    const b=req.body||{},churchId=String(b.churchId||""),planId=String(b.planId||"");if(!churchId||!planId)throw Object.assign(new Error("Igreja e plano são obrigatórios."),{statusCode:400});
    const plan=(await rest(`plans?id=eq.${encodeURIComponent(planId)}&select=*`))?.[0];if(!plan)throw Object.assign(new Error("Plano não encontrado."),{statusCode:404});
    const current=(await rest(`church_subscriptions?church_id=eq.${encodeURIComponent(churchId)}&status=in.(trialing,active,past_due,paused)&select=*&order=created_at.desc&limit=1`))?.[0];
    let sub;if(current)sub=(await rest(`church_subscriptions?id=eq.${current.id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({plan_id:plan.id,status:"active",price_monthly:plan.price_monthly,updated_at:new Date().toISOString()})}))?.[0];
    else sub=(await rest("church_subscriptions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{church_id:churchId,plan_id:plan.id,status:"active",price_monthly:plan.price_monthly,current_period_start:new Date().toISOString(),provider:"manual",metadata:{assigned_by:actor.id}}])}))?.[0];
    await rest("billing_events",{method:"POST",body:JSON.stringify([{church_id:churchId,actor_user_id:actor.id,event_type:"subscription_plan_set",entity_type:"church_subscription",entity_id:sub?.id||null,amount:plan.price_monthly,currency:"BRL",metadata:{plan_id:plan.id,plan_code:plan.code}}])});
    return res.json({ok:true,subscription:sub});
  }
  if(action==="create-coupon"&&req.method==="POST"){
    const b=req.body||{},code=String(b.code||"").trim().toUpperCase().replace(/\s+/g,"");if(!code)throw Object.assign(new Error("Informe o código do cupom."),{statusCode:400});
    const row={code,kind:b.kind==="collective"?"collective":"individual",discount_type:Number(b.percent)>=100?"free_subscription":"percentage",discount_value:Math.min(100,Math.max(1,Number(b.percent)||0)),plan_id:b.planId||null,duration_months:Math.max(1,Number(b.durationMonths)||1),valid_until:b.validUntil?`${b.validUntil}T23:59:59Z`:null,max_redemptions:b.kind==="individual"?1:(b.unlimited?null:Math.max(1,Number(b.maxAccounts)||1)),unlimited:!!b.unlimited,active:true,created_by:actor.id,metadata:{source:"admin_panel"}};
    const d=await rest("coupons",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([row])});return res.json({ok:true,coupon:d?.[0]});
  }
  if(action==="disable-coupon"&&req.method==="POST"){const id=req.body?.couponId;if(!id)throw Object.assign(new Error("Cupom ausente."),{statusCode:400});await rest(`coupons?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({active:false,updated_at:new Date().toISOString()})});return res.json({ok:true});}
  return res.status(400).json({error:"Ação administrativa inválida."});
}catch(e){console.error("billing-admin",e);return res.status(e?.statusCode||500).json({error:e?.message||"Erro administrativo."})}};
