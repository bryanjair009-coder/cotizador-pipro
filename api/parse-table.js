import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fileBase64, mimeType } = req.body;
    if (!fileBase64 || !mimeType) return res.status(400).json({ error: 'fileBase64 y mimeType requeridos' });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const isPDF = mimeType === 'application/pdf';

    const fileBlock = isPDF
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mimeType,           data: fileBase64 } };

    const prompt = `Eres un extractor de tablas de listas de materiales para proyectos de instalación industrial.

Analiza esta imagen o PDF y extrae TODAS las filas de materiales de la tabla.

Devuelve ÚNICAMENTE un JSON válido con esta estructura:
{
  "items": [
    {
      "qty": "cantidad como número o texto (ej: 30, 1, 320)",
      "partNumber": "número de parte exacto tal como aparece (ej: DN20 CLAMP IRON, NG2006, CTV-12-N)",
      "description": "descripción completa del material",
      "isPIPRO": false,
      "categoria": "sección o categoría a la que pertenece (ej: 2 pulgadas galvanizado, Material Eléctrico)"
    }
  ]
}

REGLAS IMPORTANTES:
1. Ignora filas de encabezado de sección (como "2 pulgadas galvanizado", "MATERIAL ELECTRIC") — úsalas como "categoria" en los items siguientes
2. isPIPRO = true SOLO para tubería y accesorios de aluminio PIPRO/AIRWYN (red neumática de aluminio)
3. isPIPRO = false para: galvanizado, eléctrico, PVC, válvulas solenoides, bridas de acero, condulets, abrazaderas genéricas, cable, etc.
4. Extrae el número de parte EXACTAMENTE como está escrito en la tabla
5. Si un campo está vacío usa cadena vacía ""
6. La cantidad debe ser solo el número, sin unidades

Devuelve SOLO el JSON, sin markdown, sin explicación.`;

    const resp = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: prompt }] }],
    });

    const raw = resp.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'No se pudo extraer JSON', raw });

    const parsed = JSON.parse(match[0]);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error('parse-table error:', err);
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
