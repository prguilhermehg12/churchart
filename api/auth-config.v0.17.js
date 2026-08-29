// ChurchDesign NEWFLOW v0.17 — public Supabase Auth configuration
module.exports=async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({error:"Método não permitido."});
  const supabaseUrl=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const anonKey=process.env.SUPABASE_ANON_KEY;
  if(!supabaseUrl||!anonKey)return res.status(500).json({error:"Configure SUPABASE_URL e SUPABASE_ANON_KEY na Vercel."});
  res.setHeader("Cache-Control","public, max-age=300, s-maxage=300");
  return res.status(200).json({supabaseUrl,anonKey});
};
