
async function requireChurchDesignUser(req){
  const raw=String(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const anon=process.env.SUPABASE_ANON_KEY;
  if(!raw||!anon)throw Object.assign(new Error("SUPABASE_URL ou SUPABASE_ANON_KEY não configuradas."),{statusCode:500});
  const authorization=String(req.headers.authorization||"");
  if(!/^Bearer\s+\S+/i.test(authorization))throw Object.assign(new Error("Autenticação obrigatória."),{statusCode:401});
  const r=await fetch(`${raw}/auth/v1/user`,{headers:{apikey:anon,Authorization:authorization}});
  const user=await r.json().catch(()=>null);
  if(!r.ok||!user?.id)throw Object.assign(new Error("Sessão inválida ou expirada."),{statusCode:401});
  return user;
}
function churchIdFromUser(user){
  return `usr_${String(user.id).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,76)}`;
}

// ChurchDesign V0.31.1 — resilient My Church bootstrap; no generation checkpoints
// ChurchDesign V0.30.9 — unified checkpoint persistence and historical merge
const BUCKET = "churchart-assets";

function cfg() {
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!rawUrl || !key) {
    throw new Error("SUPABASE_URL ou SUPABASE_SECRET_KEY não configuradas na Vercel.");
  }

  const url = rawUrl.replace(/\/+$/, "");

  return {
    url,
    key,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  };
}

async function rest(path, opt = {}) {
  const c = cfg();

  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...opt,
    headers: {
      ...c.headers,
      "Content-Type": "application/json",
      ...(opt.headers || {})
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.hint ||
      `Supabase REST ${response.status}`
    );
  }

  return data;
}

function safeName(name = "file") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "file";
}

function encodeObjectPath(path) {
  return String(path)
    .split("/")
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function storageObjectUrl(path) {
  const c = cfg();
  return `${c.url}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeObjectPath(path)}`;
}

function storagePublicUrl(path) {
  const c = cfg();
  return `${c.url}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodeObjectPath(path)}`;
}

async function uploadDataUrl(dataUrl, path, mime) {
  const c = cfg();

  if (typeof dataUrl !== "string" || !dataUrl.includes(",")) {
    throw new Error("Arquivo inválido.");
  }

  const base64 = dataUrl.split(",")[1];

  if (!base64) {
    throw new Error("Arquivo sem conteúdo.");
  }

  const buffer = Buffer.from(base64, "base64");
  const uploadUrl = storageObjectUrl(path);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...c.headers,
      "Content-Type": mime || "application/octet-stream",
      "x-upsert": "true"
    },
    body: buffer
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail =
      data?.message ||
      data?.error ||
      data?.statusCode ||
      text ||
      `Storage ${response.status}`;

    throw new Error(`Falha no Storage: ${detail}`);
  }

  return storagePublicUrl(path);
}

module.exports = async function handler(req, res) {
  try {
    const action = req.query.action;
    const authUser=await requireChurchDesignUser(req);
    const churchId=churchIdFromUser(authUser);
    cfg();

    if (action === "bootstrap") {
      // Assets are the critical data for "Minha Igreja". Auxiliary query failures
      // must never make the library look empty.
      const warnings=[];
      const safeRest=async(path,label,fallback=[])=>{
        try{return await rest(path)}
        catch(e){warnings.push(`${label}: ${e.message}`);return fallback}
      };

      const assetsCurrent=await safeRest(
        `church_assets?church_id=eq.${encodeURIComponent(churchId)}&select=*&order=created_at.desc`,
        "assets"
      );

      // Historical versions sometimes wrote assets using church_id="default".
      // Only use that legacy scope when the current church has no assets at all.
      let assets=assetsCurrent||[];
      let legacyAssetsRecovered=false;
      if(!assets.length&&churchId!=="default"){
        const legacy=await safeRest(
          `church_assets?church_id=eq.default&select=*&order=created_at.desc`,
          "legacy assets"
        );
        if(legacy?.length){assets=legacy;legacyAssetsRecovered=true}
      }

      const [profileCurrent,generations,drafts]=await Promise.all([
        safeRest(`church_profile?id=eq.${encodeURIComponent(churchId)}&select=*`,"profile"),
        safeRest(`church_generations?church_id=eq.${encodeURIComponent(churchId)}&select=*&order=created_at.desc&limit=100`,"gallery"),
        safeRest(`church_drafts?church_id=eq.${encodeURIComponent(churchId)}&select=*&order=updated_at.desc&limit=60`,"drafts")
      ]);

      let profile=profileCurrent||[];
      if(!profile.length&&churchId!=="default"){
        profile=await safeRest(`church_profile?id=eq.default&select=*`,"legacy profile");
      }

      const userDrafts=(drafts||[]).filter(x=>x?.title!=="__GENERATION_JOB__"&&x?.data?.kind!=="generation_job");
      return res.json({
        profile:profile?.[0]||null,
        assets:assets||[],
        generations:generations||[],
        drafts:userDrafts,
        bootstrapWarnings:warnings,
        legacyAssetsRecovered
      });
    }

    if (action === "save-profile" && req.method === "POST") {
      const body = req.body || {};

      const data = await rest("church_profile?on_conflict=id", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify([
          {
            id: churchId,
            name: body.name || "",
            address: body.address || "",
            screen_config: body.screenConfig || {preset:"16:9",width:1920,height:1080}
          }
        ])
      });

      return res.json({
        profile: data?.[0]
      });
    }

    if (action === "upload-asset" && req.method === "POST") {
      const body = req.body || {};
      const id = crypto.randomUUID();
      const originalName = safeName(body.name || "file.bin");
      const type = safeName(body.type || "asset");

      const objectPath = [
        churchId,
        type,
        `${id}-${originalName}`
      ].join("/");

      const publicUrl = await uploadDataUrl(
        body.dataUrl,
        objectPath,
        body.mimeType
      );

      const data = await rest("church_assets", {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify([
          {
            id,
            church_id: churchId,
            type: body.type || "graphic",
            name: body.name || "Asset",
            url: publicUrl,
            mime_type: body.mimeType || "",
            meta: body.meta || {},
            is_primary: false
          }
        ])
      });

      return res.json({
        asset: data?.[0]
      });
    }

    if (action === "update-asset-meta" && req.method === "POST") {
      const body=req.body||{};
      if(!body.id)throw new Error("ID do asset ausente.");
      const rows=await rest(`church_assets?id=eq.${encodeURIComponent(body.id)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`);
      const current=rows?.[0];if(!current)throw new Error("Asset não encontrado.");
      const data=await rest(`church_assets?id=eq.${encodeURIComponent(body.id)}&church_id=eq.${encodeURIComponent(churchId)}`,{
        method:"PATCH",headers:{Prefer:"return=representation"},
        body:JSON.stringify({meta:{...(current.meta||{}),...(body.meta||{})}})
      });
      return res.json({asset:data?.[0]||null});
    }

    if (action === "delete-asset" && req.method === "DELETE") {
      const id = req.body?.id;

      if (!id) {
        throw new Error("ID ausente.");
      }

      const encodedId = encodeURIComponent(id);
      const rows = await rest(`church_assets?id=eq.${encodedId}&select=*`);
      const asset = rows?.[0];

      if (asset) {
        await rest(`church_assets?id=eq.${encodedId}`, {
          method: "DELETE"
        });
      }

      return res.json({ ok: true });
    }

    if (action === "upload-generation" && req.method === "POST") {
      const body = req.body || {};
      const id = crypto.randomUUID();

      const objectPath = [
        churchId,
        "generations",
        `${Date.now()}-${id}.png`
      ].join("/");

      const url = await uploadDataUrl(
        body.dataUrl,
        objectPath,
        "image/png"
      );

      return res.json({ url });
    }

    if (action === "save-generation" && req.method === "POST") {
      const body = req.body || {};

      const data = await rest("church_generations", {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify([
          {
            church_id: churchId,
            format: body.format || "feed",
            images: body.images || []
          }
        ])
      });

      return res.json({
        generation: data?.[0]
      });
    }


    if (action === "update-asset-meta" && req.method === "POST") {
      const body=req.body||{},id=body.id;if(!id)throw new Error("ID do asset ausente.");
      const rows=await rest(`church_assets?id=eq.${encodeURIComponent(id)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`),current=rows?.[0];if(!current)throw new Error("Asset não encontrado.");
      const nextMeta={...(current.meta||current.metadata||{}),...(body.meta||{})};
      try{const updated=await rest(`church_assets?id=eq.${encodeURIComponent(id)}&church_id=eq.${encodeURIComponent(churchId)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({meta:nextMeta})});return res.json({asset:updated?.[0]||current,metadataPersisted:true});}
      catch(e){return res.json({asset:current,metadataPersisted:false,warning:"A tabela church_assets ainda não possui coluna meta."});}
    }


    if (action === "rename-gallery-project" && req.method === "POST") {
      const body = req.body || {};
      const generationId = body.generationId;
      const galleryId = body.galleryId;
      const projectName = String(body.projectName || "").trim();

      if (!generationId || !galleryId || !projectName) {
        throw new Error("generationId, galleryId e projectName são obrigatórios.");
      }

      const rows = await rest(
        `church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`
      );
      const generation = rows?.[0];
      if (!generation) throw new Error("Projeto não encontrado.");

      let found = false;
      const images = (Array.isArray(generation.images) ? generation.images : []).map(im => {
        if (String(im?.galleryId || "") !== String(galleryId)) return im;
        found = true;
        return {
          ...im,
          projectName,
          recipe: { ...(im.recipe || {}), projectName }
        };
      });
      if (!found) throw new Error("Arte principal do projeto não encontrada.");

      const updated = await rest(
        `church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ images })
        }
      );
      return res.json({ ok: true, projectName, generation: updated?.[0] || null });
    }


    if (action === "delete-gallery-item" && req.method === "DELETE") {
      const body = req.body || {};
      const generationId = body.generationId;
      const galleryId = body.galleryId;

      if (!generationId || !galleryId) {
        throw new Error("generationId e galleryId são obrigatórios.");
      }

      const rows = await rest(
        `church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}&select=*`
      );
      const generation = rows?.[0];

      // Idempotente: se já foi removido, a UI pode considerar a exclusão concluída.
      if (!generation) {
        return res.json({ ok: true, alreadyMissing: true });
      }

      const images = Array.isArray(generation.images) ? generation.images : [];
      const remaining = images.filter(
        im => String(im?.galleryId || "") !== String(galleryId)
      );

      if (remaining.length === images.length) {
        return res.json({ ok: true, alreadyMissing: true });
      }

      if (remaining.length) {
        await rest(
          `church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ images: remaining })
          }
        );
      } else {
        await rest(
          `church_generations?id=eq.${encodeURIComponent(generationId)}&church_id=eq.${encodeURIComponent(churchId)}`,
          { method: "DELETE" }
        );
      }

      return res.json({ ok: true, deletedGalleryId: galleryId });
    }


    if (action === "save-draft" && req.method === "POST") {
      const body = req.body || {};
      const id = body.id || crypto.randomUUID();
      const data = await rest("church_drafts?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([{
          id,
          church_id: churchId,
          title: body.title || "Esboço",
          data: body.data || {},
          updated_at: new Date().toISOString()
        }])
      });
      return res.json({ draft: data?.[0] });
    }

    if (action === "delete-draft" && req.method === "DELETE") {
      const id = req.body?.id;
      if (!id) throw new Error("ID do esboço ausente.");
      await rest(`church_drafts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return res.json({ ok: true });
    }

    return res.status(400).json({
      error: "Ação inválida."
    });

  } catch (error) {
    console.error("church-data", error);

    return res.status(500).json({
      error: error?.message || "Erro no banco."
    });
  }
};
