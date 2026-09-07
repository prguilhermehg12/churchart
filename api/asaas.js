// CHURCHDESIGN — asaas v0.2.0
const crypto=require("crypto");

module.exports.config={maxDuration:30};

function envCfg(){
  const supabaseUrl=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const supabaseKey=process.env.SUPABASE_SECRET_KEY;
  const asaasKey=process.env.ASAAS_API_KEY;
  const appUrl=String(process.env.APP_PUBLIC_URL||"").replace(/\/+$/,"");
  const env=String(process.env.ASAAS_ENV||"sandbox").toLowerCase()==="production"?"production":"sandbox";
  if(!supabaseUrl||!supabaseKey)throw new Error("Configuração de banco indisponível.");
  if(!asaasKey)throw new Error("Integração de pagamento ainda não configurada.");
  if(!appUrl)throw new Error("URL pública do ChurchDesign não configurada.");
  return {
    supabaseUrl,supabaseKey,asaasKey,appUrl,env,
    asaasBase:env==="production"?"https://api.asaas.com/v3":"https://api-sandbox.asaas.com/v3"
  };
}
async function rest(path,{method="GET",body,headers={}}={}){
  const c=envCfg();
  const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{
    method,
    headers:{apikey:c.supabaseKey,Authorization:`Bearer ${c.supabaseKey}`,"Content-Type":"application/json",...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await r.text(),data=text?JSON.parse(text):null;
  if(!r.ok)throw new Error("Não foi possível concluir esta operação.");
  return data;
}
async function authUser(req){
  const c=envCfg(),token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)throw Object.assign(new Error("Faça login novamente para continuar."),{statusCode:401});
  const r=await fetch(`${c.supabaseUrl}/auth/v1/user`,{headers:{apikey:c.supabaseKey,Authorization:`Bearer ${token}`}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d?.id)throw Object.assign(new Error("Sua sessão expirou. Entre novamente."),{statusCode:401});
  return d;
}
async function ownerMembership(userId,churchId){
  const rows=await rest(`church_members?church_id=eq.${encodeURIComponent(churchId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=role,status`);
  const m=rows?.[0];
  if(!m)throw Object.assign(new Error("Você não possui acesso a esta igreja."),{statusCode:403});
  if(m.role!=="owner")throw Object.assign(new Error("Somente o responsável da igreja pode contratar ou alterar o plano."),{statusCode:403});
  return m;
}
async function asaas(path,{method="GET",body}={}){
  const c=envCfg();
  const r=await fetch(`${c.asaasBase}${path}`,{
    method,
    headers:{access_token:c.asaasKey,"Content-Type":"application/json","User-Agent":"ChurchDesign/1.0"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    console.error("[ChurchDesign][Asaas]",r.status,JSON.stringify(data).slice(0,1200));
    throw Object.assign(new Error("O Asaas não conseguiu iniciar o pagamento agora. Tente novamente em instantes."),{statusCode:502});
  }
  return data;
}
function normalizePlanRequest(planId){
  const v=String(planId||"").trim().toLowerCase();
  const aliases={entrada:"entrada",essencial:"entrada",medio:"medio",pro:"medio",top:"top",studio:"top"};
  return aliases[v]||"";
}
async function planFor(planId){
  const code=normalizePlanRequest(planId);
  if(!code)throw Object.assign(new Error("Plano inválido."),{statusCode:400});
  const rows=await rest(`plans?code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,code,name,price_monthly,credits_monthly,user_limit,reference_limit&limit=1`);
  const plan=rows?.[0];
  if(!plan)throw Object.assign(new Error("Este plano ainda não está disponível para contratação."),{statusCode:409});
  return plan;
}
async function currentSub(churchId){
  const rows=await rest(`church_subscriptions?church_id=eq.${encodeURIComponent(churchId)}&status=in.(pending,trialing,active,past_due,paused)&select=*&order=created_at.desc&limit=1`);
  return rows?.[0]||null;
}
async function createCheckout(req,res,user){
  const c=envCfg(),b=req.body||{},churchId=String(b.churchId||"").trim();
  if(!churchId)throw Object.assign(new Error("Igreja não informada."),{statusCode:400});
  await ownerMembership(user.id,churchId);
  const plan=await planFor(b.planId);
  const church=(await rest(`church_profile?id=eq.${encodeURIComponent(churchId)}&select=id,name,label&limit=1`))?.[0];
  if(!church)throw Object.assign(new Error("Igreja não encontrada."),{statusCode:404});

  const sessionId=crypto.randomUUID();
  const externalReference=`cd:${churchId}:${plan.code}:${sessionId}`.slice(0,200);
  const callbackUrl=`${c.appUrl}/?billing=return&church=${encodeURIComponent(churchId)}`;

  const link=await asaas("/paymentLinks",{
    method:"POST",
    body:{
      name:`ChurchDesign • ${plan.name}`,
      description:`Assinatura mensal ChurchDesign — ${plan.name}`,
      value:Number(plan.price_monthly),
      billingType:"UNDEFINED",
      chargeType:"RECURRENT",
      dueDateLimitDays:10,
      subscriptionCycle:"MONTHLY",
      externalReference,
      notificationEnabled:true,
      callback:{successUrl:callbackUrl,autoRedirect:true}
    }
  });

  const paymentUrl=link?.url||link?.paymentLink||link?.invoiceUrl||null;
  if(!link?.id||!paymentUrl)throw Object.assign(new Error("O checkout foi criado, mas o link de pagamento não foi retornado pelo Asaas."),{statusCode:502});

  await rest("asaas_checkout_sessions",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:[{
      id:sessionId,church_id:churchId,user_id:user.id,plan_id:plan.id,
      asaas_payment_link_id:String(link.id),external_reference:externalReference,
      status:"pending",provider_environment:c.env,
      metadata:{plan_code:plan.code,plan_name:plan.name,price_monthly:Number(plan.price_monthly),credits_monthly:Number(plan.credits_monthly)||0}
    }]
  });

  const existing=await currentSub(churchId);
  if(existing){
    await rest(`church_subscriptions?id=eq.${encodeURIComponent(existing.id)}`,{
      method:"PATCH",headers:{Prefer:"return=minimal"},
      body:{status:existing.status==="active"?"active":"pending",provider:"asaas",updated_at:new Date().toISOString(),metadata:{...(existing.metadata||{}),pending_plan_id:plan.id,pending_plan_code:plan.code,last_checkout_session_id:sessionId}}
    });
  }else{
    await rest("church_subscriptions",{
      method:"POST",headers:{Prefer:"return=minimal"},
      body:[{church_id:churchId,plan_id:plan.id,status:"pending",price_monthly:Number(plan.price_monthly),provider:"asaas",metadata:{pending_plan_code:plan.code,last_checkout_session_id:sessionId}}]
    });
  }

  return res.json({ok:true,checkoutId:String(link.id),checkoutUrl:paymentUrl,environment:c.env,plan:{code:plan.code,name:plan.name,priceMonthly:Number(plan.price_monthly)}});
}
async function status(req,res,user){
  const churchId=String(req.query.churchId||"").trim();
  if(!churchId)throw Object.assign(new Error("Igreja não informada."),{statusCode:400});
  await ownerMembership(user.id,churchId);
  const sub=await currentSub(churchId);
  return res.json({ok:true,subscription:sub||null});
}

module.exports=async function handler(req,res){
  try{
    const action=String(req.query.action||"");
    const user=await authUser(req);
    if(action==="create-checkout"&&req.method==="POST")return await createCheckout(req,res,user);
    if(action==="status"&&req.method==="GET")return await status(req,res,user);
    return res.status(404).json({error:"Ação não encontrada."});
  }catch(e){
    const status=Math.max(400,Math.min(599,Number(e.statusCode)||500));
    if(status>=500)console.error("[ChurchDesign][Asaas API]",e);
    return res.status(status).json({error:status>=500?"Não foi possível concluir o pagamento agora.":String(e.message||"Não foi possível concluir esta operação.")});
  }
};
