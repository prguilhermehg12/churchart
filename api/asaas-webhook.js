// CHURCHDESIGN — asaas-webhook v0.1.0
module.exports.config={maxDuration:30};

function cfg(){
  const url=String(process.env.SUPABASE_URL||"").replace(/\/+$/,""),key=process.env.SUPABASE_SECRET_KEY,token=process.env.ASAAS_WEBHOOK_TOKEN;
  if(!url||!key||!token)throw new Error("Webhook financeiro não configurado.");
  return{url,key,token};
}
async function rest(path,{method="GET",body,headers={}}={}){
  const c=cfg();
  const r=await fetch(`${c.url}/rest/v1/${path}`,{
    method,headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"application/json",...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await r.text(),data=text?JSON.parse(text):null;
  if(!r.ok)throw new Error(`Banco indisponível (${r.status}).`);
  return data;
}
async function rpc(name,args){
  const c=cfg();
  const r=await fetch(`${c.url}/rest/v1/rpc/${name}`,{
    method:"POST",headers:{apikey:c.key,Authorization:`Bearer ${c.key}`,"Content-Type":"application/json"},body:JSON.stringify(args||{})
  });
  const text=await r.text(),data=text?JSON.parse(text):null;
  if(!r.ok)throw new Error(`RPC ${name} indisponível (${r.status}).`);
  return data;
}
function header(req,name){return String(req.headers[String(name).toLowerCase()]||"")}
function paymentId(payload){return String(payload?.payment?.id||payload?.id||"").trim()}
function paymentLinkId(payload){return String(payload?.payment?.paymentLink||payload?.paymentLink||"").trim()}
function subscriptionId(payload){return String(payload?.payment?.subscription||payload?.subscription?.id||payload?.subscription||"").trim()}
async function locateContext(payload){
  const subId=subscriptionId(payload);
  if(subId){
    const rows=await rest(`church_subscriptions?provider=eq.asaas&provider_subscription_id=eq.${encodeURIComponent(subId)}&select=*&order=created_at.desc&limit=1`);
    if(rows?.[0])return {subscription:rows[0],session:null};
  }
  const linkId=paymentLinkId(payload);
  if(linkId){
    const sessions=await rest(`asaas_checkout_sessions?asaas_payment_link_id=eq.${encodeURIComponent(linkId)}&select=*&order=created_at.desc&limit=1`);
    const s=sessions?.[0];
    if(s){
      const subs=await rest(`church_subscriptions?church_id=eq.${encodeURIComponent(s.church_id)}&select=*&order=created_at.desc&limit=1`);
      return {subscription:subs?.[0]||null,session:s};
    }
  }
  return {subscription:null,session:null};
}
async function recordEvent(eventId,eventType,payload,status="received",churchId=null){
  try{
    await rest("asaas_webhook_events",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:[{
      event_id:eventId,event_type:eventType,church_id:churchId,payload,status
    }]});
  }catch(e){console.error("[ChurchDesign][Asaas webhook event]",e.message)}
}
async function updateEvent(eventId,status,errorMessage=null){
  await rest(`asaas_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:{status,processed_at:new Date().toISOString(),error_message:errorMessage}});
}
async function alreadyProcessed(eventId){
  const rows=await rest(`asaas_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&status=eq.processed&select=event_id&limit=1`);
  return !!rows?.length;
}
async function syncPaid(payload,eventId,eventType){
  const pid=paymentId(payload);
  if(!pid)throw new Error("Pagamento sem identificador.");
  const ctx=await locateContext(payload);
  const s=ctx.session,sub=ctx.subscription;
  if(!s&&!sub)throw new Error("Pagamento não conciliado com uma igreja.");

  const churchId=String(s?.church_id||sub?.church_id||"");
  const planId=String(s?.plan_id||sub?.plan_id||"");
  const plan=(await rest(`plans?id=eq.${encodeURIComponent(planId)}&select=id,code,name,credits_monthly,price_monthly&limit=1`))?.[0];
  if(!plan)throw new Error("Plano financeiro não encontrado.");

  const providerSubId=subscriptionId(payload)||sub?.provider_subscription_id||null;
  const customerId=String(payload?.payment?.customer||sub?.provider_customer_id||"")||null;
  const dueDate=String(payload?.payment?.dueDate||payload?.payment?.originalDueDate||"")||null;
  const paidAt=String(payload?.payment?.paymentDate||payload?.payment?.clientPaymentDate||new Date().toISOString());

  // Idempotência financeira é por payment_id, não por tipo de evento.
  const grant=await rpc("renew_subscription_credits",{
    p_church_id:churchId,
    p_plan_id:plan.id,
    p_payment_id:pid,
    p_credits:Number(plan.credits_monthly)||0,
    p_paid_at:paidAt,
    p_due_date:dueDate||null,
    p_metadata:{provider:"asaas",event_id:eventId,event_type:eventType,subscription_id:providerSubId,customer_id:customerId,plan_code:plan.code}
  });

  const targetSub=sub;
  if(targetSub?.id){
    await rest(`church_subscriptions?id=eq.${encodeURIComponent(targetSub.id)}`,{
      method:"PATCH",headers:{Prefer:"return=minimal"},
      body:{
        plan_id:plan.id,status:"active",provider:"asaas",provider_subscription_id:providerSubId,
        provider_customer_id:customerId,price_monthly:Number(plan.price_monthly)||0,
        current_period_start:paidAt,current_period_end:null,updated_at:new Date().toISOString(),
        metadata:{...(targetSub.metadata||{}),last_payment_id:pid,last_payment_event:eventType,last_payment_at:paidAt}
      }
    });
  }
  if(s?.id){
    await rest(`asaas_checkout_sessions?id=eq.${encodeURIComponent(s.id)}`,{
      method:"PATCH",headers:{Prefer:"return=minimal"},
      body:{status:"paid",asaas_customer_id:customerId,asaas_subscription_id:providerSubId,paid_at:paidAt,updated_at:new Date().toISOString()}
    });
  }
  return {churchId,grant};
}
async function syncProblem(payload,eventType){
  const ctx=await locateContext(payload),sub=ctx.subscription;
  if(!sub?.id)return;
  const status=eventType==="PAYMENT_OVERDUE"?"past_due":"paused";
  await rest(`church_subscriptions?id=eq.${encodeURIComponent(sub.id)}`,{
    method:"PATCH",headers:{Prefer:"return=minimal"},
    body:{status,updated_at:new Date().toISOString(),metadata:{...(sub.metadata||{}),last_payment_event:eventType,last_problem_payment_id:paymentId(payload)||null}}
  });
}
module.exports=async function handler(req,res){
  let eventId="";
  try{
    if(req.method!=="POST")return res.status(405).json({ok:false});
    const c=cfg();
    if(header(req,"asaas-access-token")!==c.token)return res.status(401).json({ok:false});

    const payload=req.body||{},eventType=String(payload.event||"").trim();
    eventId=String(payload.id||`${eventType}:${paymentId(payload)||subscriptionId(payload)||Date.now()}`).trim();
    if(await alreadyProcessed(eventId))return res.status(200).json({ok:true,duplicate:true});
    await recordEvent(eventId,eventType,payload);

    if(["PAYMENT_CONFIRMED","PAYMENT_RECEIVED"].includes(eventType)){
      const out=await syncPaid(payload,eventId,eventType);
      await updateEvent(eventId,"processed");
      return res.status(200).json({ok:true,churchId:out.churchId});
    }
    if(["PAYMENT_OVERDUE","PAYMENT_REFUNDED","PAYMENT_CHARGEBACK_REQUESTED","PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"].includes(eventType)){
      await syncProblem(payload,eventType);
      await updateEvent(eventId,"processed");
      return res.status(200).json({ok:true});
    }

    await updateEvent(eventId,"processed");
    return res.status(200).json({ok:true,ignored:true});
  }catch(e){
    console.error("[ChurchDesign][Asaas webhook]",e);
    if(eventId)try{await updateEvent(eventId,"failed",String(e.message||"").slice(0,1000))}catch{}
    return res.status(500).json({ok:false});
  }
};
