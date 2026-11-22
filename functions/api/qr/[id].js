export async function onRequestGet(context) {
  const { params, env } = context;
  const id = String(params.id || "");

  if (!/^[a-f0-9]{16}$/.test(id)) {
    return new Response("Tautan QR tidak valid.", { status: 400 });
  }

  const { value, metadata } = await env.QR_KV.getWithMetadata(`photo:${id}`, {
    type: "arrayBuffer",
  });

  if (!value) {
    return new Response("Foto sudah kedaluwarsa (lebih dari 24 jam) atau tidak ditemukan.", {
      status: 404,
    });
  }

  return new Response(value, {
    headers: {
      "Content-Type": metadata?.mime || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
