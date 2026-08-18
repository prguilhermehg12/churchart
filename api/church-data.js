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
    cfg();

    if (action === "bootstrap") {
      const [profile, assets, generations, drafts, ratings] = await Promise.all([
        rest("church_profile?id=eq.default&select=*"),
        rest("church_assets?church_id=eq.default&select=*&order=created_at.desc"),
        rest("church_generations?church_id=eq.default&select=*&order=created_at.desc&limit=12"),
        rest("church_drafts?church_id=eq.default&select=*&order=updated_at.desc&limit=30"),
        rest("church_art_ratings?church_id=eq.default&select=*&order=created_at.desc&limit=200")
      ]);

      return res.json({
        profile: profile?.[0] || null,
        assets: assets || [],
        generations: generations || [],
        drafts: drafts || [],
        ratings: ratings || []
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
            id: "default",
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
        "default",
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
            church_id: "default",
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
        "default",
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
            church_id: "default",
            format: body.format || "feed",
            images: body.images || []
          }
        ])
      });

      return res.json({
        generation: data?.[0]
      });
    }


    if (action === "save-draft" && req.method === "POST") {
      const body = req.body || {};
      const id = body.id || crypto.randomUUID();
      const data = await rest("church_drafts?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([{
          id,
          church_id: "default",
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

    if (action === "save-rating" && req.method === "POST") {
      const body = req.body || {};
      const rating = Math.max(1, Math.min(5, Number(body.rating) || 0));
      if (!rating) throw new Error("Avaliação inválida.");
      const data = await rest("church_art_ratings", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          id: crypto.randomUUID(), church_id: "default", rating,
          format: body.format || "", design_style: body.designStyle || "",
          audience: body.audience || "", inspiration_style: body.inspirationStyle || "",
          effect: body.effect || "", meta: body.meta || {}
        }])
      });
      return res.json({ rating: data?.[0] });
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
